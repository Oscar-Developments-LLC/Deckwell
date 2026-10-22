"""
Starts or stops recording in OBS. Use it on a Script key (Python, window: Hidden).
Setup is the same as obs_switch_scene.py (WebSocket on, obsws-python installed, config.toml).
"""
import time
import obsws_python as obs

client = obs.ReqClient(timeout=3)
client.toggle_record()
time.sleep(0.5)  # give OBS a moment to start or stop
try:
    recording = client.get_record_status().output_active
    print("Recording" if recording else "Recording stopped")
except AttributeError:
    print("Toggled recording")
