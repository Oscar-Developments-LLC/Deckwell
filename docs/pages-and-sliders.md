# Pages, folders and sliders

## Pages

A page is one screen of keys on your deck.

- **Add a page:** click **+ Page** in the sidebar.
- **Rename it:** double-click it in the sidebar, or click its name above the deck.
- **Change its size:** use **Columns** (1 to 8) and **Rows** (1 to 6) above the deck. Keys get bigger or smaller to fit.
- **Delete it:** select the page with no key selected, then click **Delete page** in the right panel.

**On the deck, swipe left or right** to move between your top-level pages. The dots at the bottom show where you are.

## Folders

A folder is a page inside another page. Use folders to group things, like all your homelab keys.

- Click **+ Folder** in the sidebar, or drag **Folder** from the action bar onto a key.
- The folder page gets a **Back** key, so you can always get back out. It starts in the top-left corner. **Drag it** to move it anywhere on that page. Dropping it on another key swaps the two.
- Folders can hold other folders.

**Go to page** keys jump anywhere, and any key can switch pages after it runs with **Then show page**. See [Keys](keys.md#keys-that-do-more-than-one-thing).

## Sliders

Each page can have a strip of **volume sliders** next to its keys.

**To turn them on:** use the **Sliders** buttons above the deck.

- **Left** or **Right** puts the strip on that side of the page. In portrait, it goes across the top or bottom instead (see below).
- **Off** hides it. Your sliders are kept, so turning it back on brings them back.
- **Count** sets how many slider slots the page has, from **1 to 6**.

More sliders make the strip wider, and the keys shrink to make room. On a small tablet, 2 to 4 sliders is usually the sweet spot.

**To add a slider,** click an empty **+** slot, or drag **Slider** from the action bar onto the strip.

**Each slider controls one of these:**

| Controls | What it changes |
|---|---|
| Master | Your PC's main volume |
| App | One app's volume, like Spotify or Discord. Pick it from the apps playing sound right now. |
| Mic | Your default microphone's level |

**Slider settings:**

- **Step:** how far apart the slider's positions are. **1%** (the default) matches the Windows volume slider. A bigger step, like 5%, snaps to rounder numbers.
- **Button below:** a **Mute toggle** under the slider, or **None**.

If you pick an app that isn't running, its slider greys out on the deck until the app plays sound again.

## Portrait (holding the deck tall)

The deck can run sideways (landscape), tall (portrait), or turn with the tablet.

**To pick:** click the deck card at the top left of the editor, then **Deck orientation**:

- **Landscape:** always sideways. This is how 1.0 worked.
- **Portrait:** always tall.
- **Auto rotate:** turns when you turn the tablet. If the tablet's rotation lock is on, it stays put.

You don't build a second layout. Each page's portrait layout is made from its landscape one: **columns and rows swap**, so a 5 x 3 page becomes 3 x 5.

**To see it,** click the tall tablet button above the deck in the editor. In that view:

- **Order** picks how keys move:
  - **Reading:** keys keep their order. Key 1 stays first, then left to right, top to bottom.
  - **Mirror:** row and column swap. The key at row 2, column 4 goes to row 4, column 2.
- **Sliders** go across the **Top** or **Bottom** of the page, one slider per row. **Off** hides them in both views.

Each page has its own Order and Sliders setting. Wide keys stay wide: Now Playing stays 2 keys across, and panels keep their size when they fit. If a key doesn't fit where it would land, it moves to the next free spot.

To move keys, switch back to the landscape view. The portrait view is a preview of what the deck shows.

## Now Playing

The **Now Playing** key takes two keys side by side and shows what's playing on your PC. Put it on the same page as your sliders for a simple media page.
