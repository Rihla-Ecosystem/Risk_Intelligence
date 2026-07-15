# Risk Intelligence Engine 🌍🔒

A robust background polling engine that aggregates live safety and environmental risk data from **11 external sources** into a single aggregated JSON state per Egyptian city. 

Part of the **Rihla** AI tour guide ecosystem, keeping tourists informed of real-time safety advisories, UV index, extreme heat, air quality, seismic activity, and active fire hotspots.

---

## 🚀 How it Works

1. **Cron Polling:** Checks external global and regional threat feeds at scheduled intervals.
2. **Graceful Fallbacks:** If API keys (e.g. OpenWeather, NASA FIRMS) are missing from `.env`, the engine falls back to a realistic **Simulation Mode** tailored to Egyptian cities to guarantee the dashboard always remains active and fully functional.
3. **Deterministic Classification:** All severity indexing is rule-based and deterministic (processed instantly on-cpu with 0% AI cost or hallucinations).
4. **Windows Concurrency Safety:** Uses a coordinated in-memory **Mutex Lock** when updating `current_state.json` to prevent EPERM file locking errors on Windows environments under concurrent processes.

---

## 🗺️ Monitored Cities (Egypt)
* Cairo
* Giza
* Alexandria
* Luxor
* Aswan
* Hurghada
* Sharm el-Sheikh
* Dahab
* Marsa Alam
* El Gouna
* Siwa Oasis

---

## 🛠️ Quick Start

### 1. Configure Environment
Copy the environment template and insert your API keys (optional: Simulation Mode operates if keys are blank):
```bash
cp .env.example .env
```

### 2. Install & Run Locally
```bash
# Install dependencies
npm install

# Start development server (supports watch mode)
npm run dev

# Build for production (fully cross-platform)
npm run build

# Run unit tests
npm run test
```
The dashboard will be active at: **`http://localhost:3000`**

---

## 🐳 Running with Docker

You can spin up the application inside a Docker container with standard persistent storage setup:

```bash
# Build the image and start the application in one step
docker compose up --build
```
This mounts directories locally, retaining current states and logins across restarts.

---

## 📡 API Endpoints

* **`GET /`**: Renders the visual HTML/CSS diagnostic dashboard.
* **`GET /safety/current`**: Retrieves the current aggregated safety status (e.g., `/safety/current?city=luxor`).
* **`GET /safety/changes`**: Retrieves events logged after a specific timestamp, ideal for push notifications (e.g., `/safety/changes?since=2026-07-15T00:00:00Z`).
* **`GET /safety/health`**: Inspects API uptime, connection, and error states of all 11 external providers.

---

## 📁 Key File Structure

```
├── config/              # Source configuration intervals (sources.yaml)
├── data/                # Local database-free JSON state files & checkpoints
├── src/
│   ├── api/             # Web API routes & token-based auth
│   ├── engine/          # Polling routines, scheduler, and Mutex file locks
│   ├── severity/        # Decisive severity rules
│   ├── sources/         # Source adapters for external services
│   └── public/          # Dashboard frontend assets (HTML, CSS)
```
