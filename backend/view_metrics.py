# view_metrics.py
import os, json
from pathlib import Path
BASE_DIR = Path(__file__).resolve().parent
LOG_FILE = BASE_DIR / 'logs' / 'events.log'

def aggregate():
    metrics = {'total_events':0, 'variants':{}, 'per_poi':{}, 'rewards': {'sum':0, 'count':0}}
    if not LOG_FILE.exists():
        print("No log file at", LOG_FILE)
        return metrics
    with open(LOG_FILE, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line: continue
            try:
                e = json.loads(line)
            except:
                continue
            metrics['total_events'] += 1
            v = e.get('variant')
            if v:
                metrics['variants'][v] = metrics['variants'].get(v, 0) + 1
            p = e.get('poi_id')
            if p:
                metrics['per_poi'][str(p)] = metrics['per_poi'].get(str(p), 0) + 1
            r = e.get('reward')
            if isinstance(r, (int, float)):
                metrics['rewards']['sum'] += float(r)
                metrics['rewards']['count'] += 1
    if metrics['rewards']['count']>0:
        metrics['rewards']['avg'] = metrics['rewards']['sum'] / metrics['rewards']['count']
    else:
        metrics['rewards']['avg'] = None
    return metrics

if __name__ == '__main__':
    m = aggregate()
    print("Total events:", m['total_events'])
    print("Variant counts:", m['variants'])
    print("Top 10 POIs (by events):")
    top_pois = sorted(m['per_poi'].items(), key=lambda x: x[1], reverse=True)[:10]
    for pid, cnt in top_pois:
        print(f"  POI {pid}: {cnt} events")
    print("Rewards summary:", m['rewards'])
