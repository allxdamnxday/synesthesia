# Synesthesia: a guide

*For Freeman. Everything you need to use the instrument on your own.*

![The Studio: the same wink moving through water](images/guide/studio.png)

## The idea

Picture lying at the bottom of a bowl of colored water, looking up. A finger traces a path
through the water above. You never see the finger, only its wake. Now picture the same
movement in a bowl of honey: the same movement, a different response.

Synesthesia keeps the movement from a short clip as a **signature**: where things moved,
which way, how fast, and when. It keeps no picture of the clip. That one signature can then
move through different **materials**, visual ones (water, honey, smoke, bubbles,
filaments) and sound ones (water, honey, breath, resonance, pulse). Each material has
**properties** you can play with, such as viscosity or persistence. The movement stays
constant; the wake changes.

Nothing here labels or interprets a movement. You are the only authority on what, if
anything, becomes noticeable.

This is a first playable version, **v0**, meant for you to co-direct: every choice made
while building it is written down in `docs/DECISIONS.md` so you can revisit it.

## Before you start

- Use **Google Chrome** on your MacBook. Other browsers aren't supported yet.
- Your work lives **in Chrome on this computer**, not online. Back it up now and then (see
  "Keeping your work safe").
- After your first visit, the instrument works without the internet.
- The first time you open the Studio, it spends about three seconds "getting to know this
  computer" to choose how detailed the preview can be.

The first time you open it, a short introduction offers to start with a **sample wink** or
with a clip of your own. You can show the introduction again from Settings.

![The introduction](images/guide/introduction.png)

## The Library

The Library is home. It lists your **signatures**, **albums** and **compositions**, each
with a small picture of its wake.

![The Library](images/guide/library.png)

- **New from clip** starts a new signature. You can also drop a video file anywhere on the
  window.
- **Open** a signature to see its bare wake; **Start a composition** from its menu (the
  "…" button) opens it in the Studio; **New album** starts an album.
- **Import file** brings in a signature, composition or album file; **Export file** (in
  each item's menu) saves one to share or keep.
- **Back up everything** and **Restore from backup**: see "Keeping your work safe".

## Making a signature (Prepare)

1. **Bring in a clip.** Drop a video onto the window, or choose **Choose a clip…**. Short
   is best: a signature holds up to a minute of movement. MP4, MOV or WebM.
2. **Trim it.** Drag the handles under the clip to where the movement starts and ends, or
   step to a frame and use **Start here** and **End here**. The preview loops inside your
   trim so you can watch the movement again and again.
3. **Speed** sets how fast the signature plays by default. It doesn't change what's
   captured.
4. **Turn or mirror** the clip if it came out sideways.
5. **Box the part that moves** (optional, but best for a wink): drag on the clip to draw a
   box around the eye. Only the movement inside the box is kept, and it's stretched to fill
   the material. Drag the box to move it, or its corners to resize it.
6. **Extract signature.** A bar shows the progress; a 10-second clip takes well under a
   minute. **Cancel** stops it.

![Drawing a box around the part that moves](images/guide/prepare-focus.png)

When it's done you see the **bare wake**: a short stroke for each part of the picture,
pointing the way it moved and brighter where it moved faster. The clip is hidden (turn
**Hide source** off to see them side by side). Below, lines show the movement over time:
**energy** (how much is moving), **direction**, **expansion and contraction**,
**continuity** (smooth or jolting) and **density** (how much of the frame moves). Small
marks show **moments of sudden movement**.

![The bare wake, with the movement's lines below](images/guide/prepare-signature.png)

Name the signature and choose **Save**, or **Save and open in Studio**. The clip itself
stays on this screen and is never kept.

**If it looks faint:** a clip that moves the whole time (water, a curtain) can fool the
automatic sensitivity. Prepare says so; open **Advanced** and raise **Sensitivity**, then
**Extract again**.

## The Studio

The Studio is where you play. The wake fills most of the screen.

![The Studio](images/guide/studio.png)

- **Play** (or Space) plays the signature through the materials; **Loop** repeats it. The
  bar at the bottom shows where you are; the small marks are moments of sudden movement,
  and the striped end is the **tail**, where the wake settles after the movement ends.
- **Visual** and **Sound** each have a material picker. Choosing another material keeps
  your shared settings, so you can compare the same movement in water and in honey.

![Choosing a material](images/guide/studio-materials.png)

- **Properties.** With **Linked** on, the sliders under **Both** move sight and sound
  together, because a shared property means the same thing in each (see the table below).
  Turn Linked off to set them separately. **More** shows the less-used properties.
  Double-click a slider to return it to the material's baseline; hold Shift while dragging
  for fine control; arrow keys nudge.
- **Mute** and **Solo** let you study the picture or the sound alone.
- **Movement** holds settings for the signature itself: **Signature strength** (how hard it
  pushes), **Smoothing**, **Speed**, **Loops**, **Repeat** (loop, or back and forth), and
  **Tail** (how long the wake settles afterwards).
- **Seed**: a six-digit number that fixes every chance choice, so a composition always
  replays the same way. **New seed** picks another.
- **Snapshots A, B, C, D**: click an empty letter to store the current version there; click
  a full one to switch to it while it plays; Shift-click to replace it. (Keys: 1–4 to
  switch, Shift+1–4 to store.)
- **Notes** and **Status** (draft, kept, set aside) are part of the research record.
- **Undo** and **Redo**: Cmd+Z and Shift+Cmd+Z.
- **Present** (or F) shows only the wake, full screen. Esc comes back.
- **Save** keeps the composition in the Library with a small picture of its wake; **Save as
  new** keeps a copy. The Studio also saves your work in the background, so if Chrome
  closes unexpectedly, your changes come back the next time you open it.

### Draw by chance

**Draw by chance** (or C) lets chance choose the visual and sound materials and open a few
shared properties for play. The other shared properties stay at their baseline, **locked**
(dimmed, with a lock). You can still unlock one; the composition notes that you did, so the
record stays honest. The same seed always draws the same way.

![Draw by chance](images/guide/studio-chance.png)

## Rendering a video

**Render MP4** (or R) makes a video of the composition, frame by frame, at full quality
however long it takes.

![Render MP4](images/guide/render.png)

- **Size**: 720p, 1080p, or Square. **Frames per second**: 30 or 60.
- **Even out loudness** makes the loudest moment of every video the same level. Turn it off
  to keep quiet compositions quiet.
- **Save to**: a folder you choose (make one of your own inside Movies, for example) or your
  Downloads.
- A render can be cancelled; nothing half-made is left behind.

## Albums

An album gathers many compositions from one signature, as a body of work and a research
record. Start one from a signature's menu in the Library (**New album**).

![A new album](images/guide/album-new.png)

- Choose how many **tracks**, a **master seed**, which materials chance may use, how many
  properties each track opens for play, and the **pairing**: every visual and sound pairing
  once, or pure chance. The same master seed and settings always make the same album.
- **Generate album** makes the drafts. Open each track in the Studio to play its open
  properties; mark it **Kept** or **Set aside**, and write notes. Nothing is thrown away:
  set-aside tracks stay in the record.

![An album's tracks](images/guide/album.png)

- **Batch render** makes videos of the chosen tracks (kept ones are chosen to start with)
  into one folder, one after another, unattended. You can pause or cancel it.
- **Export album log** saves `ALBUM_LOG.md`, a readable record of every track: its
  materials, open properties, final values, any unlocked properties, its seed, its video
  file, and your notes. (Chrome asks once whether it may save two files.)

## Settings

![Settings](images/guide/settings.png)

- **Preview quality**: Automatic picks the most detailed level this computer shows
  smoothly. If the Studio feels slow, choose a lower level. Videos always render at full
  quality.
- **Renders**: the size and frame rate new videos start with.
- **Your library**: how much space your work uses, whether Chrome has agreed to keep it,
  and **Back up everything**.
- **Welcome**: the dedication when the instrument opens, and the introduction.

## Keeping your work safe

Your signatures, compositions and albums are stored by Chrome on this computer. Chrome can
clear them if the computer runs very low on space, or if its data is cleared.

- **Back up everything** (Library or Settings) saves one `.spbackup.zip` file with all of
  it. Keep it somewhere safe (another drive, or cloud storage).
- **Restore from backup** (Library) brings it all back, on this computer or another.

## If something goes wrong

- **A clip won't open.** Some iPhone videos use a format Chrome can't read on every
  computer. On the iPhone, set **Settings › Camera › Formats › Most Compatible** and record
  again, or convert the clip to MP4.
- **The Studio is slow or jerky.** Lower **Preview quality** in Settings.
- **Something else.** Open **Diagnostics** (top right), choose **Copy report**, and paste it
  into a message to Braden.

![Diagnostics](images/guide/diagnostics.png)

## Quick reference

### Shared properties

| Property | What you see | What you hear |
|---|---|---|
| Viscosity | How thick the material is: it resists flow, spreads slowly, lags behind the movement | How slowly the sound follows: longer glides, darker tone, softer attacks |
| Elasticity | How much it springs back and overshoots | How much the sound rings, bounces in pitch, and overshoots |
| Persistence | How long the wake stays visible | How long each sound lingers, and its reverb tail |
| Dispersion | How much the wake spreads, scatters, turns turbulent | How widely the sound spreads: stereo width, scatter, detuning |
| Brightness | How luminous and saturated the wake is | How bright the tone is |
| Intensity | How strongly the signature pushes the material | How loud and driven the sound is |
| Rigidity | How hard-edged and crisp shapes are | How sharp the attacks are; pitch snaps to a scale |
| Density | How much material there is | How many voices, grains or pulses |
| Range | From compressed to expanded: the scale of the movement | Pitch range, narrow to wide |

**Help** in the instrument lists every material and what each of its properties does.

### Keys (in the Studio)

| Key | Action |
|---|---|
| Space | Play or pause |
| L | Loop on or off |
| 1 – 4 | Switch to snapshot A – D |
| Shift + 1 – 4 | Store snapshot A – D |
| C | Draw by chance |
| S (or Cmd+S) | Save |
| R | Render MP4 |
| F | Present (Esc to leave) |
| Cmd+Z, Shift+Cmd+Z | Undo, redo |
