# backend script for preprocessing vibration data, compute iri, and perform mapmatching to save it to iri_latest.geojson

"""
PIPELINE:
  1) Read logs from Firestore collection "vibration_logs".
  2) Use ONLY 'y' as vertical acceleration.
  3) Denoise signal (HP + Hampel + median + moving average).
  4) Calculate cumulative distance along the raw GPS track.
  5) Window by DISTANCE (e.g., every 100m), compute IRI per window.
  6) Snap entire track to roads using Mapbox Matching API.
  7) Map distance windows onto snapped LineString, build IRI-coloured segments.
  8) Performs depulication against existing GeoJSON to eliminate repeated traversals if there's any.
  9) Save GeoJSON + upload to Firebase Storage (iri/iri_latest.geojson).
  10) Update last processed timestamp.
  
  - SPLIT TRACKS: Automatically detects gaps (time > 10s or dist > 500m) to prevent straight lines.
  - SPEED FILTER: Ignores segments where avg speed < 15km/h to prevent fake red IRI.
  - DISTANCE WINDOW: Calculates 1 value every 100m.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Tuple, Dict

import firebase_admin
import numpy as np
import pandas as pd
import requests
from firebase_admin import credentials, firestore, storage as fb_storage
import geopandas as gpd
from shapely.geometry import LineString, mapping
from math import radians, sin, cos, asin, sqrt

# ==============================
# --- CONFIGURABLE CONSTANTS ---
# ==============================

BASE_DIR = Path(__file__).parent
TEST_SINGLE_DOC_ID = None  # if u only wanna use one document to test, eg. insert 2025-12-18-21-09-14

# Collections
FIRESTORE_VIBE_COLLECTION = "vibration_logs"
FIRESTORE_STATUS_COLLECTION = "system"
FIRESTORE_STATUS_DOC = "iri_status"

# Storage
STORAGE_BUCKET_NAME = "aiot-road-app.firebasestorage.app"
STORAGE_BLOB_PATH = "iri/iri_latest.geojson"

# Mapbox
MAPBOX_ACCESS_TOKEN = os.environ.get(
    "MAPBOX_ACCESS_TOKEN",
    "pk.eyJ1Ijoibm5uaXFubm5pcSIsImEiOiJjbWllNjc0dmIwZWFuMm1wcnhscWQ4dXZuIn0.Z3aZHogxqROo852Fpd7_Vw",
)
MAPBOX_MATCH_URL = "https://api.mapbox.com/matching/v5/mapbox/driving"
MAPBOX_MAX_POINTS = 90

# Algorithm Config
IRI_WINDOW_SIZE_M = 100.0  
MIN_WINDOW_DIST_M = 20.0   
ROLLING_HP_SEC = 1.0

# --- Gap & Speed Config ---
MAX_GAP_SECONDS = 15.0     # Split track if gap > 15s
MAX_GAP_METERS = 200.0     # Split track if jump > 500m
MIN_SPEED_MPS = 8.3        # ~30 km/h. Below this, IRI is unreliable (drift).

MEDIAN_SEC = 0.20
MEAN_SEC = 0.20
HAMPEL_SEC = 0.50
HAMPEL_K = 3.0

# --- DEDUPLICATION CONFIG ---
DEDUP_BUFFER_M = 10.0   # meters (tuned for Malaysian urban roads)

# =======================
# --- FIREBASE SETUP ---
# =======================

SERVICE_ACCOUNT_PATH = BASE_DIR / "firebase_acc_key.json"
cred = credentials.Certificate(str(SERVICE_ACCOUNT_PATH))
firebase_admin.initialize_app(cred, {"storageBucket": STORAGE_BUCKET_NAME})
db = firestore.client()
bucket = fb_storage.bucket()

# =======================
# --- MATH HELPERS ---
# =======================

def _haversine_m(lat1, lon1, lat2, lon2) -> float:
    R = 6371000.0
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = (sin(dlat / 2.0) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2.0) ** 2)
    return 2.0 * R * asin(sqrt(a))

def _cumdist_raw(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    n = len(lat)
    cd = np.zeros(n, dtype=float)
    for i in range(1, n):
        cd[i] = cd[i - 1] + _haversine_m(lat[i - 1], lon[i - 1], lat[i], lon[i])
    return cd

def _cumtrapz_np(y: np.ndarray, x: np.ndarray) -> np.ndarray:
    y = np.asarray(y, dtype=float)
    x = np.asarray(x, dtype=float)
    dx = np.diff(x)
    dx[~np.isfinite(dx)] = 0.0
    dx[dx <= 0] = 1e-6
    area = 0.5 * (y[1:] + y[:-1]) * dx
    return np.concatenate(([0.0], np.cumsum(area)))

def _iri_window(t: np.ndarray, a: np.ndarray, s_m: float) -> Optional[float]:
    # Check Speed: If avg speed is too low, accelerometer drift dominates -> Fake Red IRI.
    duration = t[-1] - t[0]
    if duration <= 0: return None
    
    avg_speed = s_m / duration
    if avg_speed < MIN_SPEED_MPS:
        return None # Skip this window (too slow)

    if s_m < MIN_WINDOW_DIST_M or len(t) < 2:
        return None
        
    v = _cumtrapz_np(a, t)
    disp_equiv = np.trapezoid(np.abs(v), t)
    return float(disp_equiv / (s_m / 1000.0))

def _window_indices_by_distance(dist_arr: np.ndarray, step_m: float) -> List[Tuple[int, int]]:
    n = len(dist_arr)
    if n < 2: return []
    
    windows = []
    start_idx = 0
    start_dist = dist_arr[0]

    for i in range(1, n):
        if dist_arr[i] - start_dist >= step_m:
            windows.append((start_idx, i))
            start_idx = i
            start_dist = dist_arr[i]

    if start_idx < n - 1:
        if dist_arr[n - 1] - start_dist >= MIN_WINDOW_DIST_M:
            windows.append((start_idx, n - 1))

    return windows

# --- SIGNAL PROCESSING ---
def _estimate_fs(t: np.ndarray) -> float:
    dt = np.diff(t)
    dt = dt[np.isfinite(dt) & (dt > 0)]
    return float(1.0 / np.median(dt)) if dt.size > 0 else 100.0

def _rolling_median(y: np.ndarray, win: int) -> np.ndarray:
    return pd.Series(y).rolling(win, center=True, min_periods=1).median().to_numpy() if win > 1 else y

def _moving_average(y: np.ndarray, win: int) -> np.ndarray:
    if win <= 1: return y
    kernel = np.ones(win, dtype=float) / float(win)
    return np.convolve(y, kernel, mode="same")

def _hampel(y: np.ndarray, win: int, k: float = 3.0) -> np.ndarray:
    if win <= 1: return y.copy()
    s = pd.Series(y)
    med = s.rolling(win, center=True, min_periods=1).median()
    diff = np.abs(s - med)
    mad = 1.4826 * diff.rolling(win, center=True, min_periods=1).median()
    mask = diff > (k * mad.replace(0, np.nan))
    out = y.copy()
    out[mask] = med[mask]
    return out

def _denoise_accel(a: np.ndarray, t: np.ndarray) -> np.ndarray:
    if len(a) < 2: return a
    dt_arr = np.diff(t)
    dt_arr = dt_arr[np.isfinite(dt_arr) & (dt_arr > 0)]
    dt = float(np.median(dt_arr)) if dt_arr.size > 0 else 0.01
    
    # High Pass
    win_hp = max(3, int(round(ROLLING_HP_SEC / max(dt, 1e-6))))
    baseline = pd.Series(a).rolling(win_hp, center=True, min_periods=1).mean().to_numpy()
    hp = a - baseline

    fs = _estimate_fs(t)
    def _to_samples(sec: float) -> int:
        n = max(3, int(round(sec * fs)))
        return n if (n % 2 == 1) else n + 1

    y = _hampel(hp, _to_samples(HAMPEL_SEC), HAMPEL_K)
    y = _rolling_median(y, _to_samples(MEDIAN_SEC))
    y = _moving_average(y, _to_samples(MEAN_SEC))
    return y

# --- GEOMETRY ---
def _cut_linestring_by_m(ls_merc: LineString, d_m: float) -> Tuple[LineString, LineString]:
    if d_m <= 0.0: return LineString([]), LineString(list(ls_merc.coords))
    if d_m >= ls_merc.length: return LineString(list(ls_merc.coords)), LineString([])
    
    coords = list(ls_merc.coords)
    acc = 0.0
    for i in range(1, len(coords)):
        segment = LineString([coords[i - 1], coords[i]])
        seg_len = segment.length
        if acc + seg_len >= d_m:
            t = (d_m - acc) / seg_len
            x0, y0 = coords[i - 1]
            x1, y1 = coords[i]
            xm, ym = x0 + t*(x1-x0), y0 + t*(y1-y0)
            return LineString(coords[:i] + [(xm, ym)]), LineString([(xm, ym)] + coords[i:])
        acc += seg_len
    return LineString(list(ls_merc.coords)), LineString([])

def _substring_by_m(ls_merc: LineString, d0: float, d1: float) -> LineString:
    if d1 <= d0: return LineString([])
    _, right = _cut_linestring_by_m(ls_merc, d0)
    sub, _ = _cut_linestring_by_m(right, d1 - d0)
    return sub

def iri_to_color(v: float) -> str:
    if v < 2.5: return "#22c55e"
    elif v < 4.5: return "#eab308"
    elif v < 6.5: return "#f97316"
    else: return "#ef4444"

# ==============================
# --- FIRESTORE / DATA LOAD ---
# ==============================

def get_last_processed_ts() -> Optional[float]:
    doc_ref = db.collection(FIRESTORE_STATUS_COLLECTION).document(FIRESTORE_STATUS_DOC)
    snap = doc_ref.get()
    if not snap.exists: return None
    return float(snap.to_dict().get("lastProcessedTimestamp", 0))

def set_last_processed_ts(ts: float) -> None:
    db.collection(FIRESTORE_STATUS_COLLECTION).document(FIRESTORE_STATUS_DOC).set(
        {"lastProcessedTimestamp": float(ts), "updatedAt": firestore.SERVER_TIMESTAMP}, merge=True
    )

def load_session_samples(session_id: str) -> List[Dict]:
    session_ref = db.collection(FIRESTORE_VIBE_COLLECTION).document(session_id)
    samples = []
    for bdoc in session_ref.collection("data").stream():
        batch = bdoc.to_dict() or {}
        for row in batch.get("data", []):
            try:
                lat = float(row.get("latitude"))
                lon = float(row.get("longitude"))
                y = float(row.get("y"))
                ts = float(row.get("timestamp"))
                if ts > 1e12: ts /= 1000.0 # ms to sec
                samples.append({"t": ts, "lat": lat, "lon": lon, "y": y})
            except: continue
    samples.sort(key=lambda r: r["t"])
    return samples

def fetch_vibration_logs(last_ts: Optional[float]) -> pd.DataFrame:
    rows = []
    ids = [TEST_SINGLE_DOC_ID] if TEST_SINGLE_DOC_ID else [d.id for d in db.collection(FIRESTORE_VIBE_COLLECTION).stream()]
    
    for sid in ids:
        samples = load_session_samples(sid)
        for s in samples:
            if last_ts and s["t"] <= last_ts: continue
            rows.append({"timestamp_sec": s["t"], "latitude": s["lat"], "longitude": s["lon"], "accel_y": s["y"]})
            
    return pd.DataFrame(rows).sort_values("timestamp_sec").reset_index(drop=True) if rows else pd.DataFrame()

# ==============================
# --- CORE LOGIC: SPLIT & PROCESS ---
# ==============================

def split_into_tracks(df: pd.DataFrame) -> List[pd.DataFrame]:
    """
    Splits the main dataframe into separate 'tracks' if:
    1. Time gap > MAX_GAP_SECONDS
    2. Distance gap > MAX_GAP_METERS
    This prevents the straight-line bug.
    """
    if df.empty: return []
    
    tracks = []
    current_idx_start = 0
    n = len(df)
    
    t = df["timestamp_sec"].values
    lat = df["latitude"].values
    lon = df["longitude"].values
    
    for i in range(1, n):
        dt = t[i] - t[i-1]
        dist = _haversine_m(lat[i-1], lon[i-1], lat[i], lon[i])
        
        # Detect Gap
        if dt > MAX_GAP_SECONDS or dist > MAX_GAP_METERS:
            # Save previous track
            track = df.iloc[current_idx_start:i].copy().reset_index(drop=True)
            if len(track) > 10: # Only keep valid chunks
                tracks.append(track)
            current_idx_start = i
            
    # Last track
    if current_idx_start < n:
        track = df.iloc[current_idx_start:].copy().reset_index(drop=True)
        if len(track) > 10:
            tracks.append(track)
            
    return tracks

def process_single_track(df_track: pd.DataFrame) -> List[Tuple[LineString, float]]:
    """
    Process a single continuous driving session.
    """
    t = df_track["timestamp_sec"].to_numpy()
    lat = df_track["latitude"].to_numpy()
    lon = df_track["longitude"].to_numpy()
    a_y = df_track["accel_y"].to_numpy()
    
    # 1. Denoise
    t_rel = t - t[0]
    a_clean = _denoise_accel(a_y, t_rel)
    
    # 2. Cumulative Distance
    cd_raw = _cumdist_raw(lat, lon)
    tot_raw_m = cd_raw[-1] if len(cd_raw) > 0 else 0
    if tot_raw_m < 50: return [] # Ignore tiny tracks

    # 3. Mapbox Snap
    s_lat, s_lon = snap_track_mapbox(lat[::2], lon[::2]) # Subsample 2 for speed
    if len(s_lat) < 2: return []
    
    snapped_ls = LineString(list(zip(s_lon, s_lat)))
    ls_merc = gpd.GeoSeries([snapped_ls], crs="EPSG:4326").to_crs(epsg=3857).iloc[0]
    snapped_len_m = ls_merc.length

    # 4. Window by Distance (100m)
    windows = _window_indices_by_distance(cd_raw, IRI_WINDOW_SIZE_M)
    segments = []

    for (i0, i1) in windows:
        s0, s1 = cd_raw[i0], cd_raw[i1]
        dist = max(0.0, s1 - s0)
        
        # Calculate IRI (includes Speed Check inside)
        iri_val = _iri_window(t_rel[i0:i1+1], a_clean[i0:i1+1], dist)
        if iri_val is None: continue # Skipped (too slow or too short)

        # Map to snapped line
        d0_snap = snapped_len_m * (s0 / max(tot_raw_m, 1e-6))
        d1_snap = snapped_len_m * (s1 / max(tot_raw_m, 1e-6))
        
        sub_merc = _substring_by_m(ls_merc, d0_snap, d1_snap)
        if not sub_merc.is_empty and len(sub_merc.coords) >= 2:
            sub_wgs = gpd.GeoSeries([sub_merc], crs="EPSG:3857").to_crs(epsg=4326).iloc[0]
            segments.append((sub_wgs, iri_val))
            
    return segments

# --- MAPBOX & GEOJSON UTILS ---
def _match_chunk_mapbox(lat_chunk, lon_chunk):
    coords = ";".join(f"{lo:.6f},{la:.6f}" for la, lo in zip(lat_chunk, lon_chunk))
    try:
        r = requests.get(f"{MAPBOX_MATCH_URL}/{coords}", 
                         params={"access_token": MAPBOX_ACCESS_TOKEN, "geometries": "geojson", "tidy": "true"}, 
                         timeout=15)
        data = r.json()
        if data.get("code") == "Ok":
            coords = data["matchings"][0]["geometry"]["coordinates"]
            return np.array([p[1] for p in coords]), np.array([p[0] for p in coords])
    except: pass
    return lat_chunk, lon_chunk

def snap_track_mapbox(lat, lon):
    s_lat_all, s_lon_all = [], []
    i = 0
    n = len(lat)
    while i < n - 1:
        j = min(i + MAPBOX_MAX_POINTS, n)
        sl, slon = _match_chunk_mapbox(lat[i:j], lon[i:j])
        if i == 0:
            s_lat_all.extend(sl)
            s_lon_all.extend(slon)
        else:
            s_lat_all.extend(sl[1:]) # overlap fix
            s_lon_all.extend(slon[1:])
        i = j - 1
    return np.array(s_lat_all), np.array(s_lon_all)

def segment_cell_key(geom_wgs: LineString, grid_m: float = 50.0) -> Tuple[int, int]:
    """
    Converts a road segment into a stable spatial cell key.
    Roads re-driven later will fall into the same cell.
    """
    geom_merc = (
        gpd.GeoSeries([geom_wgs], crs="EPSG:4326")
        .to_crs(epsg=3857)
        .iloc[0]
    )

    mid = geom_merc.interpolate(0.5, normalized=True)
    return (int(mid.x // grid_m), int(mid.y // grid_m))

def deduplicate_segments(
    new_segments: List[Tuple[LineString, float]],
    old_features: List[Dict],
    buffer_m: float = DEDUP_BUFFER_M,
) -> List[Dict]:
    """
    Replace old segments ONLY where new segments overlap them.
    Always keep all new segments.
    """

    # --- Build new GeoDataFrame ---
    new_records = []
    for geom, iri in new_segments:
        if geom.is_empty:
            continue

        iri_val = safe_float(iri)
        new_records.append(
            {
                "geometry": geom,
                "iri": iri_val,
                "color": iri_to_color(iri_val),
            }
        )

    if not new_records:
        # No new data, keep all old data
        return old_features

    new_gdf = gpd.GeoDataFrame(
        new_records,
        crs="EPSG:4326",
    ).to_crs(epsg=3857)

    # --- Buffer all new segments ---
    new_union_buffer = new_gdf.geometry.buffer(buffer_m).unary_union

    # --- Filter old features ---
    kept_old_features = []
    for feat in old_features:
        try:
            old_geom = LineString(feat["geometry"]["coordinates"])
            old_geom_3857 = gpd.GeoSeries(
                [old_geom], crs="EPSG:4326"
            ).to_crs(epsg=3857).iloc[0]

            # Keep old ONLY if it does not overlap any new buffer
            if not old_geom_3857.intersects(new_union_buffer):
                kept_old_features.append(feat)

        except Exception:
            # Fail-safe: keep malformed old features
            kept_old_features.append(feat)

    # --- Convert new segments back to GeoJSON ---
    new_gdf_wgs = new_gdf.to_crs(epsg=4326)

    new_features = []
    for _, row in new_gdf_wgs.iterrows():
        new_features.append(
            {
                "type": "Feature",
                "geometry": mapping(row.geometry),
                "properties": {
                    "iri": safe_float(row["iri"]),
                    "color": row["color"],
                },
            }
        )

    return kept_old_features + new_features



def save_and_upload(new_segments, old_features):
    print(f"[INFO] Deduplicating {len(new_segments)} new segments against {len(old_features)} old ones...")

    merged_features = deduplicate_segments(
        new_segments=new_segments,
        old_features=old_features,
    )

    fc = {"type": "FeatureCollection", "features": merged_features}

    out_path = BASE_DIR / "iri_latest.geojson"
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(fc, f)

    bucket.blob(STORAGE_BLOB_PATH).upload_from_filename(
        str(out_path), content_type="application/geo+json"
    )

    print(f"[DONE] GeoJSON updated. Total segments now = {len(merged_features)}")


def load_existing_features():
    blob = bucket.blob(STORAGE_BLOB_PATH)
    if not blob.exists(): return []
    try: return json.loads(blob.download_as_text()).get("features", [])
    except: return []

def safe_float(v, default=0.0):
    if v is None:
        return default
    if isinstance(v, float) and (np.isnan(v) or np.isinf(v)):
        return default
    return float(v)

# ==================
# --- MAIN LOOP ---
# ==================

def main():
    if not MAPBOX_ACCESS_TOKEN: raise RuntimeError("Missing Mapbox Token")
    
    last_ts = get_last_processed_ts() if TEST_SINGLE_DOC_ID is None else None
    print(f"Fetch logs since: {last_ts}")
    
    df_all = fetch_vibration_logs(last_ts)
    if df_all.empty: return print("No new data.")

    # 1. SPLIT DATA INTO SEPARATE TRIPS (Fixes straight line bug)
    tracks = split_into_tracks(df_all)
    print(f"Detected {len(tracks)} distinct driving sessions.")

    all_segments = []
    
    # 2. PROCESS EACH TRIP INDEPENDENTLY
    for i, track in enumerate(tracks):
        print(f"Processing track {i+1}/{len(tracks)} ({len(track)} pts)...")
        segs = process_single_track(track)
        all_segments.extend(segs)

    if not all_segments: return print("No valid IRI segments.")

    old_features = load_existing_features() if TEST_SINGLE_DOC_ID is None else []
    save_and_upload(all_segments, old_features)

    if TEST_SINGLE_DOC_ID is None:
        set_last_processed_ts(df_all["timestamp_sec"].max())

if __name__ == "__main__":
    main()