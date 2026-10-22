"""
Switches OBS to one scene. Use it on a Script key (Python, window: Hidden).
Make one copy of this file per scene you want a key for, and change SCENE.

Setup (once):
  1. In OBS: Tools > WebSocket Server Settings > turn on "Enable WebSocket server".
     Note the port (4455) and click "Show Connect Info" for the password.
  2. Install the library:   py -m pip install obsws-python
  3. Make a file called config.toml in your user folder (C:\\Users\\<you>\\config.toml):
         [connection]
         host = "localhost"
         port = 4455
         password = "your OBS websocket password"
"""
import obsws_python as obs

SCENE = "Gaming"

client = obs.ReqClient(timeout=3)
client.set_current_program_scene(SCENE)
print(f"Scene: {SCENE}")
