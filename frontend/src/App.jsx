// App.jsx — react-leaflet map with nearest-3 POIs + recommended variant (badge) + full card
import React, { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

import { fetchPOIs, postLog, predictProfile, fetchMetrics } from './api';
import { EpsilonGreedy } from './bandit';
import { v4 as uuidv4 } from 'uuid';

// Fix Leaflet icon path for bundlers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl,
  iconUrl,
  shadowUrl
});

// small helper component to recenter map programmatically
function Recenter({ position, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.setView(position, zoom || map.getZoom(), { animate: true });
  }, [position, zoom, map]);
  return null;
}

// Haversine distance (meters)
function haversineDistance([lat1, lon1], [lat2, lon2]) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371000; // earth meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Simple styles (tweak later)
const styles = {
  page: { display: 'flex', height: '100vh', fontFamily: 'Inter, Arial, sans-serif' },
  mapCol: { flex: 2, position: 'relative' },
  sideCol: { width: 420, borderLeft: '1px solid #eee', padding: 16, overflowY: 'auto', background:'#fff' },
  poiCard: { padding: 12, borderRadius: 8, border: '1px solid #ddd', marginBottom: 12, background: '#fff' },
  button: { padding: '8px 12px', marginRight: 8, cursor: 'pointer' },
  recommendedBadge: { background: '#e9f7ef', color: '#1b7a3a', padding: '6px 8px', borderRadius: 6, display: 'inline-block', fontWeight:600 },
  smallText: { fontSize: 13, color: '#555' },
  img: { width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 6, marginTop: 8 }
};

export default function App() {
  const [pois, setPois] = useState([]);
  const [nearestPois, setNearestPois] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mapCenter, setMapCenter] = useState([20.5937, 78.9629]); // fallback center (India)
  const [zoom, setZoom] = useState(13);
  const [openPoi, setOpenPoi] = useState(null); // { poi, recommendedVariant }
  const [sessionId] = useState(() => localStorage.getItem('session_id') || (() => { const s=uuidv4(); localStorage.setItem('session_id', s); return s; })());
  const banditRef = useRef(new EpsilonGreedy(['text','audio','images'], 0.2));
  const [banditSnap, setBanditSnap] = useState(banditRef.current.snapshot());
  const [sessionEvents, setSessionEvents] = useState([]);
  const [lastProfileResp, setLastProfileResp] = useState(null);
  const [metricsCache, setMetricsCache] = useState(null);

  // runtime trackers
  const poiOpenTs = useRef(null);
  const audioPlaySeconds = useRef(0);
  const audioTimer = useRef(null);

  // load POIs and geolocate
  useEffect(() => {
    const init = async () => {
      try {
        // log session_start
        await postLog({ session_id: sessionId, event: 'session_start', ts: Date.now() });

        // attempt geolocation
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const lat = pos.coords.latitude;
              const lon = pos.coords.longitude;
              setMapCenter([lat, lon]);
              setZoom(15);
              // after geolocation we will compute nearest pois once pois loaded
            },
            (err) => {
              console.warn("Geolocation error / denied:", err);
            },
            { enableHighAccuracy: true, timeout: 5000 }
          );
        }

        // fetch POIs from backend
        const p = await fetchPOIs();
        // normalize lat/lon keys (support different field names)
        const normalized = (p || []).map(x => {
          const lat = x.lat ?? x.latitude ?? x.latlng?.lat ?? x.location?.lat ?? x.coords?.lat;
          const lon = x.lon ?? x.longitude ?? x.latlng?.lng ?? x.location?.lon ?? x.coords?.lon;
          // keep fallback for id/name/img/audio_text
          return { ...x, lat: lat !== undefined && lat !== null ? Number(lat) : null, lon: lon !== undefined && lon !== null ? Number(lon) : null, image_url: x.image_url ?? x.image ?? x.photo_url ?? null, audio_text: x.audio_text ?? x.audio ?? x.story ?? x.long_text ?? null };
        }).filter(x => x.lat !== null && x.lon !== null);
        setPois(normalized);
      } catch (e) {
        console.error("Init error", e);
      } finally {
        setLoading(false);
      }
    };
    init();

    return () => { if (audioTimer.current) clearInterval(audioTimer.current); };
  }, [sessionId]);

  // whenever pois or mapCenter changes, compute nearest 3 POIs
  useEffect(() => {
    if (!pois || pois.length === 0 || !mapCenter) return;
    const sorted = pois
      .map(p => ({ ...p, dist: haversineDistance(mapCenter, [p.lat, p.lon]) }))
      .sort((a,b) => a.dist - b.dist)
      .slice(0, 3);
    setNearestPois(sorted);
  }, [pois, mapCenter]);

  // TTS
  function speak(text) {
    if (!text) return;
    if (!('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) {
      console.error("TTS error", e);
    }
  }

  // open POI card (when marker clicked or popup 'open card' clicked)
  function onOpenPOI(poi) {
    // recommended variant from bandit (but we still allow user to choose other actions)
    const chosenIndex = banditRef.current.choose();
    const recommendedVariant = banditRef.current.arms[chosenIndex];

    // log poi_shown with recommended variant
    const evt = { session_id: sessionId, event: 'poi_shown', poi_id: poi.id, variant: recommendedVariant, ts: Date.now() };
    postLog(evt);
    setSessionEvents(prev => [...prev, evt]);

    setOpenPoi({ poi, recommendedVariant });
    poiOpenTs.current = Date.now();
    audioPlaySeconds.current = 0;
    if (audioTimer.current) clearInterval(audioTimer.current);
    audioTimer.current = setInterval(() => audioPlaySeconds.current += 1, 1000);
  }

  // end poi session
  async function onEndPOISession(poiObj, userMetricsOverride = null) {
    if (!poiObj) return;
    const time_on_card = userMetricsOverride?.time_on_card ?? ((Date.now() - (poiOpenTs.current || Date.now()))/1000);
    const audio_duration = userMetricsOverride?.audio_duration ?? 60;
    const audio_play_ratio = userMetricsOverride?.audio_play_ratio ?? Math.min(1, audioPlaySeconds.current / audio_duration);
    const scroll_depth = userMetricsOverride?.scroll_depth ?? Math.random() * 0.9;
    const image_views = userMetricsOverride?.image_views ?? Math.floor(Math.random()*3);

    // Use variant as what user actually consumed — if user pressed listen/read/view we track that as last interaction
    // For simplicity, we assume the last user_interaction event indicates actual consumed variant.
    // find last user interaction for this poi in sessionEvents
    const lastInteraction = [...sessionEvents].reverse().find(e => e.event === 'user_interaction' && e.poi_id === poiObj.poi.id);
    const actualVariant = lastInteraction ? lastInteraction.variant : poiObj.recommendedVariant || 'text';

    const payload = {
      session_id: sessionId,
      event: 'poi_session_end',
      poi_id: poiObj.poi.id,
      variant: actualVariant,
      time_on_card: Math.round(time_on_card),
      audio_play_ratio: Number(audio_play_ratio.toFixed(3)),
      scroll_depth: Number(scroll_depth.toFixed(3)),
      image_views,
      reward: (audio_play_ratio >= 0.6 || scroll_depth >= 0.8 || image_views >= 2) ? 1 : 0,
      ts: Date.now()
    };

    await postLog(payload);

    // update bandit
    const armIndex = banditRef.current.arms.indexOf(actualVariant);
    if (armIndex >= 0) {
      banditRef.current.update(armIndex, payload.reward);
      setBanditSnap(banditRef.current.snapshot());
      // persist bandit snapshot so we can see adaptation across reloads
      try { localStorage.setItem('bandit_snapshot', JSON.stringify(banditRef.current.snapshot())); } catch(e){}
    }

    if (audioTimer.current) { clearInterval(audioTimer.current); audioTimer.current = null; }
    setSessionEvents(prev => [...prev, payload]);
    setOpenPoi(null);
  }

  // user pressed one of the three action buttons (view photo / listen / read)
  function onUserAction(poiObj, action) {
    // action: 'images'|'audio'|'text'
    // log user_interaction
    const evt = { session_id: sessionId, event: 'user_interaction', poi_id: poiObj.poi.id, variant: action, action: 'interacted', ts: Date.now() };
    postLog(evt);
    setSessionEvents(prev => [...prev, evt]);

    // perform UI action
    if (action === 'audio') {
      speak(poiObj.poi.audio_text ?? poiObj.poi.long_text ?? poiObj.poi.short_text ?? `Listen to ${poiObj.poi.name}`);
      // bump audioPlaySeconds slightly so reward can be triggered in demo
      audioPlaySeconds.current += 8;
    } else if (action === 'text') {
      // show details in an alert for demo; better to render modal
      window.alert(poiObj.poi.long_text ?? poiObj.poi.short_text ?? "No details available");
    } else if (action === 'images') {
      // open photo in new tab if URL present
      const url = poiObj.poi.image_url;
      if (url) window.open(url, '_blank');
      else window.alert('No photo available');
    }
  }

  // compute session features (simple)
  function aggregateSessionFeatures(events) {
    const audio = events.filter(e => typeof e.audio_play_ratio !== 'undefined').map(e => e.audio_play_ratio);
    const scroll = events.filter(e => typeof e.scroll_depth !== 'undefined').map(e => e.scroll_depth);
    const timeOn = events.filter(e => typeof e.time_on_card !== 'undefined').map(e => e.time_on_card);
    const imageViews = events.filter(e => typeof e.image_views !== 'undefined').map(e => e.image_views);
    const poisVisited = new Set(events.filter(e => e.poi_id).map(e => e.poi_id));
    return {
      avg_audio_play_ratio: audio.length ? (audio.reduce((a,b) => a+b,0)/audio.length) : 0,
      avg_scroll_depth: scroll.length ? (scroll.reduce((a,b) => a+b,0)/scroll.length) : 0,
      avg_time_on_card: timeOn.length ? (timeOn.reduce((a,b) => a+b,0)/timeOn.length) : 0,
      sum_image_views: imageViews.length ? imageViews.reduce((a,b) => a+b,0) : 0,
      num_pois: poisVisited.size
    };
  }

  // call /api/predict_profile to get RF/GMM outputs and seed bandit
  async function callProfileAndSeed() {
    const features = aggregateSessionFeatures(sessionEvents);
    const resp = await predictProfile(features);
    if (resp) {
      setLastProfileResp(resp);
      banditRef.current.seedFromProfile(resp.rf_prediction, resp.gmm_probs || null);
      setBanditSnap(banditRef.current.snapshot());
      await postLog({ session_id: sessionId, event: 'profile_predicted', features, rf_prediction: resp.rf_prediction, rf_probs: resp.rf_probs || null, gmm_probs: resp.gmm_probs || null, ts: Date.now() });
    } else {
      console.error("predictProfile failed");
    }
  }

  async function refreshMetrics() {
    const m = await fetchMetrics();
    setMetricsCache(m);
  }

  // on load, try restore bandit snapshot from localStorage
  useEffect(() => {
    try {
      const s = localStorage.getItem('bandit_snapshot');
      if (s) {
        const snap = JSON.parse(s);
        if (snap && snap.counts && snap.values) {
          // restore into banditRef
          const b = banditRef.current;
          // basic restore: copy arrays if lengths match arms
          if (snap.counts.length === b.counts.length) {
            b.counts = snap.counts.slice();
            b.values = snap.values.slice();
            setBanditSnap(b.snapshot());
          }
        }
      }
    } catch (e) { /* ignore */ }
  }, []);

  // UI: marker list component (three nearest)
  function MarkerList() {
    if (loading) return <div style={{padding:12}}>Loading POIs...</div>;
    if (!nearestPois || nearestPois.length === 0) return <div style={{padding:12}}>No POIs nearby.</div>;
    return (
      <div style={{padding:12}}>
        <h4>Nearest POIs</h4>
        {nearestPois.map((poi, idx) => (
          <div key={poi.id} style={{...styles.poiCard, display:'flex', gap:10}}>
            <div style={{flex:1}}>
              <strong>{poi.name}</strong>
              <div style={styles.smallText}>{poi.short_text?.slice(0,120)}</div>
              <div style={{marginTop:8}}>
                <small style={{color:'#666'}}>Distance: {(poi.dist/1000).toFixed(2)} km</small>
              </div>
            </div>
            <div style={{display:'flex', flexDirection:'column', alignItems:'flex-end'}}>
              <button style={styles.button} onClick={() => { setMapCenter([poi.lat, poi.lon]); setZoom(16); onOpenPOI(poi); }}>Open</button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // side card show for opened poi (mirrors screenshot layout)
  function OpenPoiCard() {
    if (!openPoi) {
      return <div style={{padding:12}}>Click a marker to open a POI card.</div>;
    }
    const { poi, recommendedVariant } = openPoi;
    return (
      <div style={styles.poiCard}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
          <h3 style={{margin:0}}>{poi.name}</h3>
          <div style={styles.recommendedBadge}>Recommended: {recommendedVariant}</div>
        </div>

        <div style={{marginTop:8, color:'#444'}}>{poi.short_text}</div>

        <div style={{marginTop:10}}>
          <button style={styles.button} onClick={() => onUserAction(openPoi, 'images')}>View Photo</button>
          <button style={styles.button} onClick={() => onUserAction(openPoi, 'audio')}>Listen to Story</button>
          <button style={styles.button} onClick={() => onUserAction(openPoi, 'text')}>Read Details</button>
        </div>

        {poi.image_url ? <img src={poi.image_url} alt={poi.name} style={styles.img} /> : (
          // optionally show a placeholder if no image
          <div style={{...styles.img, background:'#f3f3f3', display:'flex', alignItems:'center', justifyContent:'center', color:'#999'}}>No image</div>
        )}

        <div style={{marginTop:10, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
          <div style={{fontSize:13, color:'#666'}}>Source: {poi.source ?? 'Local data'}</div>
          <div>
            <button style={styles.button} onClick={() => onEndPOISession(openPoi)}>Close & Log</button>
            <button style={styles.button} onClick={() => onEndPOISession(openPoi, { time_on_card:80, audio_play_ratio:0.95, scroll_depth:0.9, image_views:3 })}>End POI (force reward)</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.mapCol}>
        <MapContainer center={mapCenter} zoom={zoom} style={{height:'100%', width:'100%'}}>
          <Recenter position={mapCenter} zoom={zoom} />
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url='https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
          />
          {nearestPois.map(poi => (
            <Marker key={poi.id} position={[poi.lat, poi.lon]} eventHandlers={{ click: () => onOpenPOI(poi) }}>
              <Popup>
                <div style={{minWidth:220}}>
                  <strong>{poi.name}</strong>
                  <div style={{fontSize:13, color:'#333', marginTop:6}}>{poi.short_text?.slice(0,120)}</div>
                  <div style={{marginTop:8}}>
                    <button style={styles.button} onClick={() => onOpenPOI(poi)}>Open Card</button>
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      <div style={styles.sideCol}>
        <h2 style={{marginTop:0}}>Heritage Tour</h2>
        <div style={{marginBottom:8}}>
          Session: <code style={{fontSize:12}}>{sessionId}</code>
        </div>

        <div style={{marginBottom:10}}>
          <button style={styles.button} onClick={callProfileAndSeed}>Compute Profile & Seed Bandit</button>
          <button style={styles.button} onClick={refreshMetrics}>Refresh Admin Metrics</button>
        </div>

        <div>
          <h4>POI Details</h4>
          {OpenPoiCard()}
        </div>

        <div style={{marginTop:12}}>
          <h4>Nearest POIs</h4>
          <MarkerList />
        </div>

        <div style={{marginTop:12}}>
          <h4>Debug / Bandit</h4>
          <div style={{padding:10, background:'#f7f7f7', borderRadius:6}}>
            <div><strong>Bandit snapshot</strong></div>
            <pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(banditSnap, null, 2)}</pre>
            <div style={{marginTop:8}}>
              <strong>Last profile response:</strong>
              <pre style={{whiteSpace:'pre-wrap'}}>{lastProfileResp ? JSON.stringify(lastProfileResp, null, 2) : 'none'}</pre>
            </div>
            <div style={{marginTop:8}}>
              <strong>Session events (recent):</strong> {sessionEvents.length}
              <details>
                <summary>Show recent events</summary>
                <pre style={{maxHeight:200, overflow:'auto'}}>{JSON.stringify(sessionEvents.slice(-30), null, 2)}</pre>
              </details>
            </div>
            <div style={{marginTop:8}}>
              <strong>Admin metrics:</strong>
              <pre>{metricsCache ? JSON.stringify(metricsCache, null, 2) : 'Not fetched'}</pre>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
