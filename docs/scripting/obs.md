# Streaming with OBS

There are two ways to control OBS from your deck.

## The easy way: OBS hotkeys

No scripts needed. Works for anything OBS has a hotkey for.

1. In OBS, open **Settings > Hotkeys**.
2. Give the action a shortcut nobody else uses, like `Ctrl+Alt+F1` for a scene or `Ctrl+Alt+R` for start recording.
3. In Deckwell, drag **Hotkey** onto a key and record the same shortcut.

OBS hotkeys work even when OBS isn't the window in front.

**The catch:** the deck can't tell whether it worked, and every action needs its own shortcut.

## The scripted way: OBS WebSocket

OBS has a built-in remote control called **WebSocket**. Small Python scripts can use it to switch scenes, start and stop recording, and mute sources, and report back what happened.

### Setup (once)

1. **Turn on the WebSocket server in OBS:** **Tools > WebSocket Server Settings**, tick **Enable WebSocket server**. Click **Show Connect Info** and note the **port** (4455) and **password**.
2. **Install Python** from [python.org](https://www.python.org/downloads/). Tick **"Add python.exe to PATH"** in the installer.
3. **Install the OBS library.** Open PowerShell:
   ```powershell
   py -m pip install obsws-python
   ```
4. **Save your connection details** in a file called `config.toml` in your user folder (`C:\Users\<you>\config.toml`), so they aren't copied into every script:
   ```toml
   [connection]
   host = "localhost"
   port = 4455
   password = "your OBS websocket password"
   ```

### The scripts

Save them in a folder like `C:\Scripts\obs`. Drag **Python** onto a key, pick the file, and set **Window** to **Hidden**.

| Script | What it does | Change at the top |
|---|---|---|
| [`obs_switch_scene.py`](../examples/obs/obs_switch_scene.py) | Switches to one scene | `SCENE = "Gaming"` |
| [`obs_toggle_record.py`](../examples/obs/obs_toggle_record.py) | Starts or stops recording, then shows which | (nothing) |
| [`obs_toggle_mic.py`](../examples/obs/obs_toggle_mic.py) | Mutes or unmutes a source, then shows which | `SOURCE = "Mic/Aux"` |

**One scene per key:** make a copy of `obs_switch_scene.py` for each scene (`obs_scene_gaming.py`, `obs_scene_brb.py`, ...) and change `SCENE` in each.

### Write your own

The library has a method for almost everything OBS can do. Method names are the OBS WebSocket request names in `snake_case`:

```python
import obsws_python as obs

client = obs.ReqClient(timeout=3)          # reads config.toml
client.set_current_program_scene("BRB")    # SetCurrentProgramScene
client.toggle_record()                     # ToggleRecord
client.toggle_input_mute("Mic/Aux")        # ToggleInputMute
print("Done")                              # the last line shows on the deck
```

The full list of requests is in the [OBS WebSocket protocol docs](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md). The method names in `obs_toggle_record.py` follow that pattern. If one doesn't work with your OBS version, check that page.

## Put it together: a streaming page

1. Make a page called **Stream** with a key per scene, plus **Record** and **Mic** keys.
2. Add a **Launch app** key for OBS on your main page, with **Then show page: Stream**.
3. Turn on **Sliders** for the Stream page with **Master**, your game, and **Mic**.

Now one tap opens OBS and switches the deck to your stream controls.

## When it doesn't work

| Last run says | Fix |
|---|---|
| `ModuleNotFoundError: No module named 'obsws_python'` | Run `py -m pip install obsws-python` again. If you have several Pythons, use the same one Deckwell finds (`py`). |
| `ConnectionRefusedError` | OBS isn't open, or the WebSocket server is off. |
| Authentication failed | The password in `config.toml` doesn't match OBS. |
| An error saying a scene or source wasn't found | The name is spelled differently from OBS. Names are case-sensitive. |
