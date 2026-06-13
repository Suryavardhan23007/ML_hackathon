from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
import json, uuid, time, os
import numpy as np
from joblib import load

app = Flask(__name__)
CORS(app)

# -------------------------------------------------------------------
# --- BASIC PATHS AND SETUP -----------------------------------------
# -------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
POIS_PATH = os.path.join(BASE_DIR, 'data', 'pois.json')
LOG_DIR = os.path.join(BASE_DIR, 'logs')
LOG_FILE = os.path.join(LOG_DIR, 'events.log')
MODEL_DIR = os.path.join(BASE_DIR, 'models')

os.makedirs(LOG_DIR, exist_ok=True)
os.makedirs(MODEL_DIR, exist_ok=True)

# -------------------------------------------------------------------
# --- LOAD POIs -----------------------------------------------------
# -------------------------------------------------------------------
try:
    with open(POIS_PATH, 'r', encoding='utf-8') as f:
        POIS = json.load(f)
    print(f"Loaded {len(POIS)} POIs from data/pois.json")
except Exception as e:
    print("Error loading pois.json:", e)
    POIS = []

# -------------------------------------------------------------------
# --- ENDPOINT: GET POIs --------------------------------------------
# -------------------------------------------------------------------
@app.route('/api/pois', methods=['GET'])
def get_pois():
    """
    Returns full POI list. Optionally ?n=10 to limit count.
    """
    n = request.args.get('n', default=None, type=int)
    if n:
        return jsonify(POIS[:n])
    return jsonify(POIS)

# -------------------------------------------------------------------
# --- ENDPOINT: LOG EVENT -------------------------------------------
# -------------------------------------------------------------------
@app.route('/api/log', methods=['POST'])
def log_event():
    """
    Accepts JSON payload and appends it as a line to logs/events.log
    """
    payload = request.get_json(force=True)
    payload.setdefault('server_ts', time.time())
    payload.setdefault('id', str(uuid.uuid4()))

    # Coerce poi_id to str to avoid JSON sorting issues later
    if 'poi_id' in payload and payload['poi_id'] is not None:
        payload['poi_id'] = str(payload['poi_id'])

    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(json.dumps(payload, ensure_ascii=False) + '\n')
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500
    return jsonify({'status': 'ok'})

# -------------------------------------------------------------------
# --- ENDPOINT: METRICS (SAFE JSON) ---------------------------------
# -------------------------------------------------------------------
@app.route('/api/admin/metrics', methods=['GET'])
def metrics():
    """
    Aggregates logs into simple metrics: total events, variant counts,
    rewards summary, and per-POI counts.
    """
    metrics = {
        'total_events': 0,
        'variant_counts': {},
        'rewards': {'sum': 0.0, 'count': 0},
        'per_poi': {}
    }

    if os.path.exists(LOG_FILE):
        with open(LOG_FILE, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except Exception:
                    continue

                metrics['total_events'] += 1

                # Variant counts
                variant = e.get('variant')
                if variant is not None:
                    variant = str(variant)
                    metrics['variant_counts'][variant] = metrics['variant_counts'].get(variant, 0) + 1

                # Rewards
                reward = e.get('reward')
                if isinstance(reward, (int, float)):
                    metrics['rewards']['sum'] += float(reward)
                    metrics['rewards']['count'] += 1

                # Per-POI counts
                poi = e.get('poi_id')
                if poi is not None:
                    pid = str(poi)
                    metrics['per_poi'][pid] = metrics['per_poi'].get(pid, 0) + 1

    # Average reward
    if metrics['rewards']['count'] > 0:
        metrics['rewards']['avg'] = metrics['rewards']['sum'] / metrics['rewards']['count']
    else:
        metrics['rewards']['avg'] = None

    # Ensure JSON-safe types
    metrics['variant_counts'] = {str(k): int(v) for k, v in metrics['variant_counts'].items()}
    metrics['per_poi'] = {str(k): int(v) for k, v in metrics['per_poi'].items()}
    metrics['total_events'] = int(metrics['total_events'])
    metrics['rewards']['sum'] = float(metrics['rewards']['sum'])
    metrics['rewards']['count'] = int(metrics['rewards']['count'])

    return jsonify(metrics)

# -------------------------------------------------------------------
# --- ENDPOINT: SERVE MODEL FILES ----------------------------------
# -------------------------------------------------------------------
@app.route('/api/models/<path:filename>', methods=['GET'])
def serve_model_file(filename):
    """
    Serve saved model files for download if needed.
    """
    model_path = os.path.join(MODEL_DIR, filename)
    if not os.path.exists(model_path):
        return jsonify({'status': 'error', 'message': 'not found'}), 404
    return send_file(model_path)

# -------------------------------------------------------------------
# --- ENDPOINT: PREDICT PROFILE (RF + GMM) --------------------------
# -------------------------------------------------------------------
RF_PATH = os.path.join(MODEL_DIR, 'rf_profile_classifier.joblib')
GMM_PATH = os.path.join(MODEL_DIR, 'gmm_profiles.joblib')
_rf_model = None
_gmm_model = None

FEATURES = [
    'avg_audio_play_ratio',
    'avg_scroll_depth',
    'avg_time_on_card',
    'sum_image_views',
    'num_pois'
]

def load_models():
    global _rf_model, _gmm_model
    if _rf_model is None and os.path.exists(RF_PATH):
        _rf_model = load(RF_PATH)
        print("Loaded RF model from", RF_PATH)
    if _gmm_model is None and os.path.exists(GMM_PATH):
        _gmm_model = load(GMM_PATH)
        print("Loaded GMM model from", GMM_PATH)

@app.route('/api/predict_profile', methods=['POST'])
def predict_profile():
    """
    Accepts JSON with session-level features (same as FEATURES).
    Returns predicted cluster and probabilities from RF + GMM.
    """
    load_models()
    payload = request.get_json(force=True)
    x = [float(payload.get(f, 0.0)) for f in FEATURES]
    X = np.array(x).reshape(1, -1)

    out = {
        'feature_names': FEATURES,
        'input': {FEATURES[i]: x[i] for i in range(len(FEATURES))}
    }

    # Random Forest prediction
    if _rf_model is not None:
        try:
            pred = _rf_model.predict(X).tolist()[0]
            out['rf_prediction'] = int(pred)
            if hasattr(_rf_model, 'predict_proba'):
                out['rf_probs'] = _rf_model.predict_proba(X).tolist()[0]
        except Exception as e:
            out['rf_error'] = str(e)
    else:
        out['rf_error'] = 'RF model not loaded'

    # GMM soft cluster probabilities
    if _gmm_model is not None:
        try:
            probs = _gmm_model.predict_proba(X).tolist()[0]
            out['gmm_probs'] = probs
        except Exception as e:
            out['gmm_error'] = str(e)
    else:
        out['gmm_error'] = 'GMM model not loaded'

    return jsonify(out)

@app.route('/api/admin/sessions', methods=['GET'])
def list_sessions():
    """
    Scan backend/logs/events.log and return an array of session summary objects:
      [{ session_id: str, first_ts: float, last_ts: float, event_count: int }, ...]
    Query params:
      - limit (int): return at most this many sessions (default 100)
      - recent (int): if provided, returns sessions seen in last `recent` seconds
    """
    limit = int(request.args.get('limit', 100))
    recent_seconds = request.args.get('recent', None)
    recent_cutoff = None
    if recent_seconds is not None:
        try:
            recent_cutoff = float(time.time()) - float(recent_seconds)
        except:
            recent_cutoff = None

    sessions = {}  # session_id -> {'first':ts,'last':ts,'count':n}
    if os.path.exists(LOG_FILE):
        with open(LOG_FILE, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except Exception:
                    continue
                sid = e.get('session_id')
                if sid is None:
                    continue
                # coerce to string
                sid = str(sid)
                ts = e.get('ts') or e.get('server_ts') or time.time()
                try:
                    tsf = float(ts)
                except:
                    tsf = time.time()
                # if recent_cutoff set, skip older sessions
                if recent_cutoff is not None and tsf < recent_cutoff:
                    continue
                rec = sessions.get(sid)
                if rec is None:
                    sessions[sid] = {'first': tsf, 'last': tsf, 'count': 1}
                else:
                    if tsf < rec['first']:
                        rec['first'] = tsf
                    if tsf > rec['last']:
                        rec['last'] = tsf
                    rec['count'] += 1

    # convert to sorted list (most recent first), coerce types
    session_list = []
    for sid, rec in sessions.items():
        session_list.append({
            'session_id': str(sid),
            'first_ts': float(rec['first']),
            'last_ts': float(rec['last']),
            'event_count': int(rec['count'])
        })
    session_list.sort(key=lambda x: x['last_ts'], reverse=True)
    session_list = session_list[:max(0, int(limit))]

    return jsonify({'count': len(session_list), 'sessions': session_list})

# -------------------------------------------------------------------
# --- RUN SERVER ----------------------------------------------------
# -------------------------------------------------------------------
if __name__ == '__main__':
    print("Starting Flask server on http://0.0.0.0:8000")
    app.run(host='0.0.0.0', port=8000, debug=True)
