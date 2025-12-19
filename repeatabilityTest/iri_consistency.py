import json
import numpy as np
from firebase_admin import credentials, initialize_app, storage
import matplotlib.pyplot as plt

# ======================
# CONFIG
# ======================
SERVICE_ACCOUNT_PATH = "python/firebase_acc_key.json"
STORAGE_BUCKET_NAME = "aiot-road-app.firebasestorage.app"
STORAGE_TEST_PREFIX = "test/"   # folder containing all test geojsons

# ======================
# FIREBASE INIT
# ======================
cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
initialize_app(cred, {"storageBucket": STORAGE_BUCKET_NAME})
bucket = storage.bucket()

# ======================
# LOAD ALL TEST FILES
# ======================
blobs = [
    b for b in bucket.list_blobs(prefix=STORAGE_TEST_PREFIX)
    if b.name.endswith(".geojson")
]

if len(blobs) < 2:
    raise RuntimeError("Need at least 2 traversals for consistency analysis")

traversal_means = []

print("\n=== PER-TRAVERSAL IRI MEANS ===")

for blob in blobs:
    geojson = json.loads(blob.download_as_text())

    iri_vals = [
        f["properties"]["iri"]
        for f in geojson.get("features", [])
        if "iri" in f.get("properties", {})
    ]

    if len(iri_vals) == 0:
        print(f"[WARN] {blob.name}: no IRI values, skipped")
        continue

    iri_vals = np.array(iri_vals, dtype=float)
    mean_iri = np.mean(iri_vals)

    traversal_means.append(mean_iri)
    print(f"{blob.name}: mean IRI = {mean_iri:.3f} km/m")

if len(traversal_means) < 2:
    raise RuntimeError("Not enough valid traversals after filtering")

# ======================
# CONSISTENCY METRICS
# ======================
traversal_means = np.array(traversal_means)

mean_of_means = np.mean(traversal_means)
std_of_means = np.std(traversal_means, ddof=1)
cv = std_of_means / mean_of_means

# ======================
# OUTPUT
# ======================
print("\n=== IRI CONSISTENCY SUMMARY ===")
print(f"Number of traversals     : {len(traversal_means)}")
print(f"Mean IRI (km/m)          : {mean_of_means:.3f}")
print(f"Std Deviation (km/m)     : {std_of_means:.3f}")
print(f"Coefficient of Var (%)   : {cv * 100:.2f}%")

# ======================
# VISUALISATION
# ======================
plt.figure(figsize=(6, 4))
plt.plot(range(1, len(traversal_means) + 1), traversal_means, marker="o")
plt.xlabel("Traversal Number")
plt.ylabel("Mean IRI (km/m)")
plt.title("IRI Consistency Across Repeated Traversals")
plt.grid(True)
plt.tight_layout()
plt.show()
