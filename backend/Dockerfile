# Use Debian slim as base
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1
ENV DEBIAN_FRONTEND=noninteractive

# Install system packages 
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gdal-bin \
    libgdal-dev \
    libproj-dev \
    proj-bin \
    libgeos-dev \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Environment variables for GDAL
ENV CPLUS_INCLUDE_PATH=/usr/include/gdal
ENV C_INCLUDE_PATH=/usr/include/gdal

WORKDIR /app

# Copy requirements
COPY requirements.txt .

# Install dependencies
RUN pip install --upgrade pip setuptools wheel
RUN pip install -r requirements.txt

# Copy the rest of the code
COPY . /app

CMD ["python", "iri_processing.py"]