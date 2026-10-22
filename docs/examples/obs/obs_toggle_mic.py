"""
Mutes or unmutes an audio source in OBS. Use it on a Script key (Python, window: Hidden).
Change SOURCE to the name of your mic in OBS's Audio Mixer.
Setup is the same as obs_switch_scene.py (WebSocket on, obsws-python installed, config.toml).
"""
import obsws_python as obs

SOURCE = "Mic/Aux"

client = obs.ReqClient(timeout=3)
client.toggle_input_mute(SOURCE)
try:
    muted = client.get_input_mute(SOURCE).input_muted
    print(f"{SOURCE} muted" if muted else f"{SOURCE} live")
except AttributeError:
    print(f"Toggled {SOURCE}")
