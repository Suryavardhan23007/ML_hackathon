# 🏛️ Heritage Tour — ML Hackathon (Group 17)

An intelligent **location-aware heritage tour web application** that uses **Machine Learning** (Gaussian Mixture Models + Random Forest) and a **Multi-Armed Bandit** (Epsilon-Greedy) to personalise content delivery to each tourist in real time.

---

## 📖 Project Overview

As users explore cultural heritage sites, the app:
1. **Detects their GPS location** and shows the 3 nearest Points of Interest (POIs) on an interactive map.
2. **Recommends the best content variant** (`audio` / `text` / `images`) per POI using an Epsilon-Greedy bandit that adapts to user behaviour.
3. **Logs every interaction** (time on card, scroll depth, audio play ratio, image views) to a backend server.
4. **Trains ML models** offline from the collected logs — a GMM clusters users into behaviour profiles and a Random Forest learns to classify new sessions into those profiles instantly.
5. **Seeds the bandit with the predicted profile** so future recommendations are personalised from the very first visit.

---

## 🗂️ Project Structure

```
ML_hackathon/
├── README.md                   ← This file
├── About_Project.docx          ← Project description document
├── ML_hackathon grp 17.pptx    ← Presentation slides
├── codes to run.txt            ← Quick-start commands reference
│
├── backend/                    ← Python Flask API server
│   ├── main.py                 ← Main Flask application (all API endpoints)
│   ├── requirements.txt        ← Python package dependencies
│   ├── simulate_logs.py        ← Script to generate synthetic interaction logs
│   ├── train_from_logs.py      ← Script to train GMM + Random Forest models
│   ├── train_from_logs.ipynb   ← Jupyter notebook version of training pipeline
│   ├── view_metrics.py         ← CLI tool to inspect aggregated metrics from logs
│   │
│   ├── data/
│   │   └── pois.json           ← Dataset of Points of Interest (name, lat/lon, text, image)
│   │
│   ├── logs/
│   │   └── events.log          ← Append-only JSONL log of all user interaction events
│   │
│   ├── models/                 ← Saved trained ML models (auto-generated)
│   │   ├── gmm_profiles.joblib           ← Trained Gaussian Mixture Model
│   │   └── rf_profile_classifier.joblib  ← Trained Random Forest Classifier
│   │
│   └── backend/                ← (Legacy/nested copy of models folder)
│       └── models/
│
└── frontend/                   ← React + Vite web application
    ├── index.html              ← App entry point HTML
    ├── vite.config.js          ← Vite bundler configuration
    ├── package.json            ← Node.js dependencies and scripts
    │
    ├── src/
    │   ├── main.jsx            ← React app bootstrap
    │   ├── App.jsx             ← Main application component (map, POI cards, UI logic)
    │   ├── api.js              ← API helper functions to communicate with Flask backend
    │   └── bandit.js           ← Epsilon-Greedy Multi-Armed Bandit implementation
    │
    └── pages/
        └── index.jsx           ← (Reserved for future page routing)
```

---

## 🧠 Machine Learning Components

### 1. Gaussian Mixture Model (GMM)
- **Purpose**: Unsupervised clustering of user sessions into behaviour profiles (e.g., *audio listener*, *reader*, *visual browser*).
- **Features used**: `avg_audio_play_ratio`, `avg_scroll_depth`, `avg_time_on_card`, `sum_image_views`, `num_pois`
- **Default**: 3 Gaussian components (profiles).
- **Output**: Soft cluster probabilities per session.

### 2. Random Forest Classifier
- **Purpose**: Supervised model trained to predict GMM cluster labels for new, incoming sessions — enabling fast, real-time profile prediction without re-running the GMM.
- **Input**: Same 5 session-level features as GMM.
- **Output**: Hard cluster label + per-class probabilities.

### 3. Epsilon-Greedy Multi-Armed Bandit
- **Arms**: `text`, `audio`, `images`
- **ε = 0.2**: 20% random exploration, 80% exploiting the best-performing arm.
- **Reward signal**: 1 if user engagement threshold is crossed (audio play ≥ 60%, scroll depth ≥ 80%, or image views ≥ 2), else 0.
- **Profile seeding**: When a user's profile is predicted, the bandit's priors are seeded from GMM soft probabilities, so it starts exploring in the right direction immediately.
- **Persistence**: Bandit state is saved in `localStorage` so it adapts across page reloads within the same browser session.

---

## 🔌 Backend API Endpoints

The Flask server runs on **`http://localhost:8000`**.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/pois` | Returns all POIs. Optional `?n=10` to limit count. |
| `POST` | `/api/log` | Logs a user interaction event (JSONL appended to `events.log`). |
| `POST` | `/api/predict_profile` | Accepts session features; returns RF prediction + GMM soft probabilities. |
| `GET` | `/api/admin/metrics` | Aggregated metrics: total events, variant counts, avg reward, per-POI counts. |
| `GET` | `/api/admin/sessions` | Lists all sessions with first/last timestamp and event count. Optional `?limit=` and `?recent=` filters. |
| `GET` | `/api/models/<filename>` | Serves saved model files for download. |

---

## 🚀 Getting Started

### Prerequisites
- Python 3.9+
- Node.js 18+ and npm

---

### Backend Setup

```bash
# Navigate to the backend folder
cd backend

# Create and activate a virtual environment
python -m venv venv
source venv/bin/activate        # macOS/Linux
# venv\Scripts\activate         # Windows

# Install dependencies
pip install -r requirements.txt

# Start the Flask server
python main.py
# Server starts at http://0.0.0.0:8000
```

---

### Frontend Setup

```bash
# Navigate to the frontend folder
cd frontend

# Install Node dependencies
npm install

# Start the development server
npm run dev
# App runs at http://localhost:5173
```

Open your browser at **http://localhost:5173** — the app will request location permission and show nearby POIs on the map.

---

### Generating Synthetic Logs (for training)

If you want to pre-populate `logs/events.log` with simulated user sessions before training:

```bash
cd backend
source venv/bin/activate
python simulate_logs.py
# Generates 1500 simulated sessions by default
```

---

### Training the ML Models

After collecting enough events in `logs/events.log` (real or simulated):

```bash
cd backend
source venv/bin/activate
python train_from_logs.py
# Trains GMM + Random Forest, saves models to backend/models/
```

You can also open **`train_from_logs.ipynb`** in Jupyter for an interactive training walkthrough.

---

### Viewing Metrics (CLI)

```bash
cd backend
source venv/bin/activate
python view_metrics.py
# Prints total events, variant breakdown, top-10 POIs by interaction count, and reward stats
```

---

## 🧪 Testing API Endpoints

**Predict user profile:**
```bash
curl -X POST http://localhost:8000/api/predict_profile \
  -H "Content-Type: application/json" \
  -d '{"avg_audio_play_ratio":0.6,"avg_scroll_depth":0.2,"avg_time_on_card":45,"sum_image_views":1,"num_pois":3}'
```

**Fetch admin metrics:**
```bash
curl http://localhost:8000/api/admin/metrics | jq
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18, Vite, React-Leaflet, Recharts |
| **Map** | Leaflet.js + OpenStreetMap tiles |
| **Backend** | Python, Flask, Flask-CORS |
| **ML Models** | scikit-learn (GMM, RandomForestClassifier) |
| **Data** | NumPy, Pandas |
| **Model Persistence** | joblib |
| **Bandit Algorithm** | Custom Epsilon-Greedy (vanilla JS) |

---

## 📊 Event Log Schema

Each line in `logs/events.log` is a JSON object with the following fields:

```json
{
  "session_id": "uuid-string",
  "event": "poi_session_end",
  "poi_id": "123",
  "poi_name": "Qutub Minar",
  "variant": "audio",
  "audio_play_ratio": 0.75,
  "scroll_depth": 0.3,
  "time_on_card": 62.5,
  "image_views": 1,
  "reward": 1,
  "ts": 1718276400.0,
  "server_ts": 1718276400.5,
  "id": "event-uuid"
}
```

**Event types**: `session_start`, `poi_shown`, `user_interaction`, `poi_session_end`, `profile_predicted`

---

## 👥 Team

**Group 17** — B.Tech Sem 5, Machine Learning Hackathon  
Amrita Vishwa Vidyapeetham

---

## 📄 License

This project was developed as part of an academic ML hackathon. All rights reserved by the team members.
