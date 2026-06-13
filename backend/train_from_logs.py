# train_from_logs.py
import os, json
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.mixture import GaussianMixture
from sklearn.ensemble import RandomForestClassifier
from joblib import dump

BASE_DIR = Path(__file__).resolve().parent
LOG_FILE = BASE_DIR / 'logs' / 'events.log'
MODEL_DIR = BASE_DIR / 'models'
MODEL_DIR.mkdir(parents=True, exist_ok=True)

def load_events():
    events = []
    if not LOG_FILE.exists():
        print("No logs found at", LOG_FILE)
        return events
    with open(LOG_FILE, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line: continue
            try:
                events.append(json.loads(line))
            except Exception as e:
                print("Skipping bad line:", e)
                continue
    return events

def build_session_features(events):
    # aggregate events by session_id
    sessions = {}
    for e in events:
        sid = e.get('session_id', 'anon')
        if sid not in sessions:
            sessions[sid] = {
                'audio_play_ratio': [], 'scroll_depth': [], 'time_on_card': [],
                'image_views': [], 'pois': set(), 'variants': [], 'rewards': []
            }
        s = sessions[sid]
        if 'audio_play_ratio' in e: s['audio_play_ratio'].append(float(e.get('audio_play_ratio', 0)))
        if 'scroll_depth' in e: s['scroll_depth'].append(float(e.get('scroll_depth', 0)))
        if 'time_on_card' in e: s['time_on_card'].append(float(e.get('time_on_card', 0)))
        if 'image_views' in e: s['image_views'].append(int(e.get('image_views', 0)))
        if 'poi_id' in e: s['pois'].add(str(e.get('poi_id')))
        if 'variant' in e: s['variants'].append(e.get('variant'))
        if 'reward' in e: s['rewards'].append(int(e.get('reward', 0)))

    rows = []
    for sid, s in sessions.items():
        row = {'session_id': sid}
        row['avg_audio_play_ratio'] = float(np.mean(s['audio_play_ratio'])) if s['audio_play_ratio'] else 0.0
        row['avg_scroll_depth'] = float(np.mean(s['scroll_depth'])) if s['scroll_depth'] else 0.0
        row['avg_time_on_card'] = float(np.mean(s['time_on_card'])) if s['time_on_card'] else 0.0
        row['sum_image_views'] = int(np.sum(s['image_views'])) if s['image_views'] else 0
        row['num_pois'] = int(len(s['pois']))
        row['avg_reward'] = float(np.mean(s['rewards'])) if s['rewards'] else 0.0
        # label: most frequent variant in session (fallback text)
        row['label_variant'] = (max(set(s['variants']), key=s['variants'].count)
                                if s['variants'] else 'text')
        rows.append(row)
    df = pd.DataFrame(rows)
    # Ensure dataframe columns exist even if empty
    for c in ['avg_audio_play_ratio','avg_scroll_depth','avg_time_on_card','sum_image_views','num_pois','avg_reward','label_variant']:
        if c not in df.columns:
            df[c] = 0
    return df

def train_and_save(df, n_components=3):
    feats = ['avg_audio_play_ratio','avg_scroll_depth','avg_time_on_card','sum_image_views','num_pois']
    if df.shape[0] < 3:
        print("Not enough sessions to train (need >=3). Found:", df.shape[0])
        return
    X = df[feats].fillna(0).values
    # Train GMM
    print("Training GMM with n_components =", n_components)
    gmm = GaussianMixture(n_components=n_components, random_state=42)
    gmm.fit(X)
    # Soft assignments + hard labels
    probs = gmm.predict_proba(X)
    hard_labels = probs.argmax(axis=1)
    # Train classifier to map features -> GMM label (so we can classify new sessions quickly)
    print("Training RandomForestClassifier to predict GMM labels")
    clf = RandomForestClassifier(n_estimators=100, random_state=42)
    clf.fit(X, hard_labels)
    # Save
    dump(gmm, MODEL_DIR / 'gmm_profiles.joblib')
    dump(clf, MODEL_DIR / 'rf_profile_classifier.joblib')
    print("Saved models to", MODEL_DIR)

def main():
    events = load_events()
    print("Loaded", len(events), "events")
    df = build_session_features(events)
    print("Built session dataframe with", len(df), "rows")
    if df.empty:
        print("No session rows. Exiting.")
        return
    # show a quick summary
    print(df.head())
    # Train with 3 components by default
    train_and_save(df, n_components=3)

if __name__ == '__main__':
    main()