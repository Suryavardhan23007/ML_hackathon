# simulate_logs.py
import os, json, random, time, uuid
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
LOG_FILE = BASE_DIR / 'logs' / 'events.log'
POIS_FILE = BASE_DIR / 'data' / 'pois.json'

def load_pois():
    try:
        with open(POIS_FILE, 'r', encoding='utf-8') as f:
            pois = json.load(f)
            # keep id as string for consistency
            for p in pois:
                p['id'] = str(p.get('id'))
            return pois
    except Exception as e:
        print("Could not load pois.json:", e)
        return [{'id': '1', 'name': 'poi_1'}, {'id': '2', 'name': 'poi_2'}]

def random_session(session_id, pois, num_pois=5):
    events = []
    for i in range(num_pois):
        poi = random.choice(pois)
        poi_id = poi.get('id', f'poi_{random.randint(1,100)}')
        # pick variant with some realistic skew
        variant = random.choices(['audio','text','images'], weights=[0.4,0.35,0.25])[0]
        # simulate metrics
        if variant == 'audio':
            audio_play_ratio = round(random.random()*0.9 + 0.05, 3)  # often some play
            scroll_depth = round(random.random()*0.3, 3)
            image_views = random.randint(0,1)
        elif variant == 'text':
            audio_play_ratio = round(random.random()*0.2, 3)
            scroll_depth = round(random.random()*0.95, 3)
            image_views = random.randint(0,1)
        else: # images
            audio_play_ratio = round(random.random()*0.2, 3)
            scroll_depth = round(random.random()*0.4, 3)
            image_views = random.randint(0,5)

        time_on_card = round(random.uniform(5,120) * (1.2 if variant=='audio' else 1.0), 2)
        reward = 1 if ((variant=='audio' and audio_play_ratio>0.6) \
                       or (variant=='text' and scroll_depth>0.6) \
                       or (variant=='images' and image_views>=2)) else 0

        e = {
            'session_id': session_id,
            'event': 'poi_session_end',
            'poi_id': poi_id,
            'poi_name': poi.get('name'),
            'variant': variant,
            'audio_play_ratio': audio_play_ratio,
            'scroll_depth': scroll_depth,
            'time_on_card': time_on_card,
            'image_views': image_views,
            'reward': reward,
            'ts': time.time()
        }
        events.append(e)
    return events

def main(num_sessions=20):
    pois = load_pois()
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    appended = 0
    with open(LOG_FILE, 'a', encoding='utf-8') as f:
        for i in range(num_sessions):
            sid = str(uuid.uuid4())
            evs = random_session(sid, pois, num_pois=random.randint(3,8))
            for e in evs:
                f.write(json.dumps(e, ensure_ascii=False) + '\n')
                appended += 1
    print(f"Appended {appended} events from {num_sessions} sessions to {LOG_FILE}")

if __name__ == '__main__':
    # default add 50 sessions; change arg to main(...) to alter
    main(num_sessions=1500)