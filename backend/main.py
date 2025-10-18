# main.py
from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
import json, uuid, time, os

app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
POIS_PATH = os.path.join(BASE_DIR, 'data', 'pois.json')
LOG_DIR = os.path.join(BASE_DIR, 'logs')
LOG_FILE = os.path.join(LOG_DIR, 'events.log')
MODEL_DIR = os.path.join(BASE_DIR, 'models')

os.makedirs(LOG_DIR, exist_ok=True)
os.makedirs(MODEL_DIR, exist_ok=True)

# Load POIs once
try:
    with open(POIS_PATH, 'r', encoding='utf-8') as f:
        POIS = json.load(f)
except Exception as e:
    print("Error loading pois.json:", e)
    POIS = []

@app.route('/api/pois', methods=['GET'])
def get_pois():
    """
    Returns full POI list. Frontend may request lat/lon query params
    and filter nearest on client if desired.
    """
    # Optionally limit number returned by ?n=10
    n = request.args.get('n', default=None, type=int)
    if n:
        return jsonify(POIS[:n])
    return jsonify(POIS)

@app.route('/api/log', methods=['POST'])
def log_event():
    """
    Accepts JSON event payload and appends it as a line to the file logs/events.log
    """
    payload = request.get_json(force=True)
    # Add server timestamp and id if missing
    payload.setdefault('server_ts', time.time())
    payload.setdefault('id', str(uuid.uuid4()))
    # Persist to file
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(json.dumps(payload, ensure_ascii=False) + '\n')
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500
    return jsonify({'status': 'ok'})

@app.route('/api/admin/metrics', methods=['GET'])
def metrics():
    """
    Quick aggregation from logs: total events, variant counts, rewards summary,
    and simple per-poi counts.
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
                if not line.strip(): continue
                metrics['total_events'] += 1
                try:
                    e = json.loads(line)
                except:
                    continue
                variant = e.get('variant')
                if variant:
                    metrics['variant_counts'][variant] = metrics['variant_counts'].get(variant, 0) + 1
                reward = e.get('reward')
                if isinstance(reward, (int, float)):
                    metrics['rewards']['sum'] += float(reward)
                    metrics['rewards']['count'] += 1
                poi = e.get('poi_id')
                if poi:
                    metrics['per_poi'][poi] = metrics['per_poi'].get(poi, 0) + 1
    # add average reward
    if metrics['rewards']['count'] > 0:
        metrics['rewards']['avg'] = metrics['rewards']['sum'] / metrics['rewards']['count']
    else:
        metrics['rewards']['avg'] = None
    return jsonify(metrics)

@app.route('/api/models/<path:filename>', methods=['GET'])
def serve_model_file(filename):
    """
    Optional: serve saved model files for frontend download (if needed).
    """
    model_path = os.path.join(MODEL_DIR, filename)
    if not os.path.exists(model_path):
        return jsonify({'status': 'error', 'message': 'not found'}), 404
    return send_file(model_path)

if __name__ == '__main__':
    print("Starting Flask server on http://0.0.0.0:8000")
    app.run(host='0.0.0.0', port=8000, debug=True)