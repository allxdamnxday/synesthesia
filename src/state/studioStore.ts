/**
 * Studio state (Zustand): the working composition and its signature, undo history,
 * snapshots A–D, Draw by chance options, save/autosave, and a mirror of the transport
 * for the UI. The preview runtime (src/studio/runtime.ts) is the source of truth for the
 * playhead; it registers itself as the `controller` and reports back through
 * `runtimeEvents`. Every edit to the wake goes through the pure functions in
 * src/studio/edits.ts and one undo step (a slider drag is one step).
 */
import { create } from 'zustand';
import { navigate } from '../app/router';
import { drawByChance } from '../chance/draw';
import { timelineDuration, type Composition, type CompositionStatus } from '../engine/composition';
import { materialVersionChanges } from '../engine/compositionFactory';
import { UndoHistory } from '../engine/history';
import type { SnapshotSlot, Snapshots } from '../engine/snapshots';
import {
  clearWorkingState,
  errorDetail,
  findSignatureForComposition,
  getAlbum,
  getComposition,
  getSetting,
  getSettings,
  getSignature,
  loadWorkingState,
  RENDER_RESOLUTIONS,
  saveComposition,
  saveWorkingState,
  setAlbumRender,
  setSetting,
  userMessage,
} from '../library';
import {
  DEFAULT_SOUND_ID,
  DEFAULT_VISUAL_ID,
  getSoundMaterial,
  getVisualMaterial,
  listSoundMaterials,
  listVisualMaterials,
} from '../materials/registry';
import type { Quality } from '../materials/types';
import type { KineticSignature } from '../signature/types';
import { Debouncer } from '../studio/autosave';
import {
  chanceSoundMetas,
  chanceVisualMetas,
  choiceInfo,
  registryCatalog,
} from '../studio/catalog';
import {
  applyChanceDraw,
  compositionsDiffer,
  defsOf,
  editLinked,
  editProperty,
  editSeed,
  editTimeline,
  followDefaultName,
  switchMaterial,
  toggleMute,
  toggleSolo,
  unlockProperty,
  wakeOf,
  withInstalledVersions,
  withWake,
  type Field,
  type WakeState,
} from '../studio/edits';
import { thumbnailTime } from '../studio/moments';
import { resolvePreviewQuality } from '../studio/quality';
import type {
  PictureProblem,
  RuntimeTimeline,
  RuntimeTransport,
  SoundProblem,
  StillOptions,
} from '../studio/runtime';
import {
  freshComposition,
  restorableComposition,
  saveAsNewName,
  targetKey,
  workingKey,
  workingRecord,
  type StudioTarget,
} from '../studio/working';
import { recordEdit, type Gesture } from '../studio/undo';
import type { SliderPhase } from '../ui/Slider';
import { usePresentationStore } from './presentationStore';
import { newSeed } from './seed';
import { forgetVisitClip } from './visitClips';

export type StudioStatus =
  'idle' | 'loading' | 'ready' | 'missing-composition' | 'missing-signature' | 'failed';

/**
 * What a notice offers besides Dismiss: 'discard' unsaved changes; 'next' (after a new
 * composition's first save) Render MP4 and New album; 'tip' has none (the first-visit tip,
 * which goes when playback starts).
 */
export type StudioNoticeAction = 'discard' | 'next' | 'tip';

export interface StudioNotice {
  id: number;
  tone: 'info' | 'success' | 'warning' | 'error';
  text: string;
  action?: StudioNoticeAction;
}

/** What the runtime lets the UI do to playback. */
export interface TransportController {
  play(): void;
  pause(): void;
  togglePlay(): void;
  seek(t: number): void;
  scrub(t: number, phase: SliderPhase): void;
  setLoop(loop: boolean): void;
  renderStill(options: StillOptions): Promise<string | null>;
}

/** The Draw by chance popover, which opens and closes itself (the store mirrors it). */
export interface ChancePopoverHandle {
  toggle(): void;
  close(): void;
}

export interface ChanceOptions {
  /** Eligible materials (ids); all by default. */
  visualPool: string[];
  soundPool: string[];
  /** K open properties, 1–3 (default 2). */
  openCount: number;
  /** Chance also chooses values for the open properties. */
  chooseValues: boolean;
}

/** A composition waiting for its signature. */
export interface MissingSignature {
  name: string;
}

export type { Gesture } from '../studio/undo';

export interface StudioState {
  status: StudioStatus;
  /** Plain-language reason when status is 'failed'. */
  failure: string | null;
  missingSignature: MissingSignature | null;
  /** Increments on every load; the preview runtime is rebuilt per session. */
  session: number;
  target: StudioTarget | null;
  signature: KineticSignature | null;
  /** The album this composition is a track of, if any (for the breadcrumb). */
  album: { id: string; title: string } | null;
  composition: Composition | null;
  /** What "unchanged" means: the saved composition, or the fresh one for a new composition. */
  baseline: Composition | null;
  /** Not saved to the library yet. */
  isNew: boolean;
  canUndo: boolean;
  canRedo: boolean;
  snapshots: Snapshots;
  activeSlot: SnapshotSlot | null;
  notices: StudioNotice[];
  chance: ChanceOptions;
  loop: boolean;
  transport: RuntimeTransport;
  timeline: RuntimeTimeline;
  picture: PictureProblem | null;
  sound: SoundProblem | null;
  /** Preview quality tier; null while this computer is being measured. */
  quality: Quality | null;
  /**
   * How strongly the clip shows over the wake, 0 (hidden) to 1 (SPEC 6.3 "Clip layer").
   * A way of looking, not part of the composition: never saved, undone or rendered.
   */
  clipOpacity: number;
  /** The clip could not be played, so its layer was taken away. */
  clipFailed: boolean;
  presentation: boolean;
  renderOpen: boolean;
  /** Mirrors the Draw by chance popover. */
  chanceOpen: boolean;
  saving: boolean;
  controller: TransportController | null;
  chancePopover: ChancePopoverHandle | null;

  load: (target: StudioTarget) => Promise<void>;
  /** Leaving the Studio: write any pending autosave and close the session. */
  leave: () => Promise<void>;
  setQuality: (quality: Quality) => void;
  setClipOpacity: (opacity: number) => void;
  /** The clip layer reports that its clip can't be played any more. */
  clipFailedToPlay: () => void;

  attachController: (controller: TransportController) => void;
  detachController: (controller: TransportController) => void;
  runtimeEvents: {
    transport: (state: RuntimeTransport) => void;
    timeline: (info: RuntimeTimeline) => void;
    picture: (problem: PictureProblem | null) => void;
    sound: (problem: SoundProblem | null) => void;
  };

  togglePlay: () => void;
  setLoop: (loop: boolean) => void;
  seek: (t: number, phase: SliderPhase) => void;

  setProperty: (field: Field, id: string, value: number, gesture: Gesture) => void;
  setMaterial: (field: Field, materialId: string) => void;
  setLinked: (linked: boolean) => void;
  setTimeline: (patch: Partial<Composition['timeline']>, gesture?: Gesture) => void;
  setSeed: (seed: number) => void;
  rollSeed: () => void;
  toggleMute: (field: Field) => void;
  toggleSolo: (field: Field) => void;
  unlock: (id: string) => void;
  drawChance: () => boolean;
  setChanceOptions: (patch: Partial<ChanceOptions>) => void;
  /** The popover reports whether it is open. */
  setChanceOpen: (open: boolean) => void;
  attachChancePopover: (handle: ChancePopoverHandle) => void;
  detachChancePopover: (handle: ChancePopoverHandle) => void;
  /** Open or close Draw by chance (the C key). */
  toggleChance: () => void;
  undo: () => void;
  redo: () => void;
  storeSnapshot: (slot: SnapshotSlot) => void;
  recallSnapshot: (slot: SnapshotSlot) => void;

  rename: (name: string) => void;
  setNotes: (notes: string) => void;
  setStatus: (status: CompositionStatus) => void;
  save: () => Promise<boolean>;
  saveAsNew: () => Promise<boolean>;
  discardChanges: () => Promise<void>;
  dismissNotice: (id: number) => void;

  setPresentation: (on: boolean) => void;
  setRenderOpen: (open: boolean) => void;
  /** The Render dialog closed; `fileName` is the MP4 made, if any. */
  renderClosed: (fileName: string | null) => void;
  /**
   * The first time the Studio opens (and guidance is on): a tip to press Play. The caller
   * decides whether first-visit hints may show at all (not in automated browsers).
   */
  showFirstVisitTip: () => Promise<void>;
}

const MATERIAL_CHANGED =
  'This material has changed since this composition was saved; it may look or sound different.';

/** After a new composition's first save: where to go next (with Render MP4 and New album). */
export function nextStepsText(signatureName: string): string {
  return `Saved in your Library. Next, make a video of it, or let chance draw an album of compositions from “${signatureName}”.`;
}

/** The first time the Studio opens: the stage is dark until Play. */
export const FIRST_VISIT_TIP =
  'Press Play (or Space) to see and hear the signature move through the materials. While it plays, try another material or move a slider.';

/** Where-next guidance is on unless the person turned it off (Hide, or Settings). */
async function guidanceOn(): Promise<boolean> {
  try {
    return await getSetting('showGuidance');
  } catch {
    return false;
  }
}

/** The first-visit tip is offered once per page, even if the Studio is opened twice at once. */
let tipOffered = false;

const EMPTY_TRANSPORT: RuntimeTransport = {
  playing: false,
  position: 0,
  duration: 0,
  catchingUp: false,
};

function defaultChanceOptions(): ChanceOptions {
  return {
    visualPool: chanceVisualMetas().map((m) => m.id),
    soundPool: chanceSoundMetas().map((m) => m.id),
    openCount: 2,
    chooseValues: false,
  };
}

let history: UndoHistory<WakeState> | null = null;
let noticeCount = 0;
let loadToken = 0;

const autosave = new Debouncer<{ key: string; composition: Composition | null }>({
  write: async ({ key, composition }) => {
    if (composition)
      await saveWorkingState(key, workingRecord(composition, new Date().toISOString()));
    else await clearWorkingState(key);
  },
  onError: (error) => console.warn('Autosave failed:', errorDetail(error)),
});

/** Drop a waiting autosave and let any write already under way finish (before clearing). */
async function settleAutosave(): Promise<void> {
  autosave.cancel();
  await autosave.flush();
}

function notice(tone: StudioNotice['tone'], text: string, action?: StudioNoticeAction) {
  return { id: ++noticeCount, tone, text, action };
}

function newId(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

export const useStudioStore = create<StudioState>()((set, get) => {
  /** Record a new wake as one undo step (or part of the current gesture's step). */
  /** The composition with a new wake (a default name follows its materials). */
  const rewoken = (composition: Composition, next: WakeState): Composition => ({
    ...withWake(composition, next),
    name: followDefaultName(composition, next, registryCatalog),
  });

  const commit = (next: WakeState, gesture?: Gesture): void => {
    const { composition } = get();
    const h = history;
    if (!composition || !h || !recordEdit(h, next, gesture)) return;
    set({ composition: rewoken(composition, next), canUndo: h.canUndo, canRedo: h.canRedo });
  };

  const present = (): WakeState | null => history?.present ?? null;

  /** Text changes (name, notes, status): not undo steps, but saved and autosaved. */
  const editText = (patch: Partial<Pick<Composition, 'name' | 'notes' | 'status'>>): void => {
    const { composition } = get();
    if (!composition) return;
    set({ composition: { ...composition, ...patch } });
  };

  const startSession = (
    target: StudioTarget,
    signature: KineticSignature,
    composition: Composition,
    baseline: Composition,
    isNew: boolean,
    notices: StudioNotice[],
    quality: Quality | null,
    album: StudioState['album'] = null,
  ): void => {
    history = new UndoHistory<WakeState>(wakeOf(composition));
    set((s) => ({
      status: 'ready',
      failure: null,
      missingSignature: null,
      session: s.session + 1,
      target,
      signature,
      album,
      composition,
      baseline,
      isNew,
      canUndo: false,
      canRedo: false,
      snapshots: {},
      activeSlot: null,
      notices,
      chance: defaultChanceOptions(),
      transport: {
        ...EMPTY_TRANSPORT,
        duration: timelineDuration(
          signature.frameCount / signature.frameRate,
          composition.timeline,
        ),
      },
      timeline: { duration: 0, tailStart: 0, markers: [] },
      picture: null,
      sound: null,
      quality,
      // Each composition opens with the source out of sight.
      clipOpacity: 0,
      clipFailed: false,
      presentation: false,
      renderOpen: false,
      chanceOpen: false,
      saving: false,
    }));
  };

  const fail = (status: StudioStatus, failure: string | null, missing?: MissingSignature) => {
    history = null;
    set({
      status,
      failure,
      missingSignature: missing ?? null,
      signature: null,
      album: null,
      composition: null,
      baseline: null,
    });
  };

  /** Save `record` to the library with a fresh thumbnail; returns what was stored. */
  const store = async (record: Composition): Promise<Composition> => {
    const { controller, signature, transport } = get();
    let thumbnail = record.thumbnail;
    if (controller && signature) {
      try {
        const t = thumbnailTime(signature, record.timeline, transport.duration);
        thumbnail =
          (await controller.renderStill({ t, width: 320, height: 180, type: 'image/jpeg' })) ??
          thumbnail;
      } catch (error) {
        console.warn('The thumbnail could not be drawn:', errorDetail(error));
      }
    }
    const withVersions = withInstalledVersions({ ...record, thumbnail }, registryCatalog);
    if (withVersions.thumbnail === undefined) delete withVersions.thumbnail;
    return saveComposition(withVersions);
  };

  return {
    status: 'idle',
    failure: null,
    missingSignature: null,
    session: 0,
    target: null,
    signature: null,
    album: null,
    composition: null,
    baseline: null,
    isNew: false,
    canUndo: false,
    canRedo: false,
    snapshots: {},
    activeSlot: null,
    notices: [],
    chance: defaultChanceOptions(),
    loop: true,
    transport: EMPTY_TRANSPORT,
    timeline: { duration: 0, tailStart: 0, markers: [] },
    picture: null,
    sound: null,
    quality: null,
    clipOpacity: 0,
    clipFailed: false,
    presentation: false,
    renderOpen: false,
    chanceOpen: false,
    saving: false,
    controller: null,
    chancePopover: null,

    async load(target) {
      const current = get();
      // Already open (e.g. the address changed after saving a new composition).
      if (
        current.status === 'ready' &&
        current.target &&
        targetKey(current.target) === targetKey(target)
      ) {
        return;
      }
      if (
        current.status === 'ready' &&
        target.kind === 'composition' &&
        current.composition?.id === target.compositionId
      ) {
        set({ target });
        return;
      }
      const token = ++loadToken;
      await autosave.flush();
      set({ status: 'loading', failure: null, missingSignature: null });
      try {
        const settings = await getSettings();
        const quality = resolvePreviewQuality(settings);
        const key = workingKey(target);
        if (target.kind === 'new') {
          const signature = await getSignature(target.signatureId);
          if (token !== loadToken) return;
          if (!signature) {
            fail('missing-signature', null);
            return;
          }
          const visual = getVisualMaterial(DEFAULT_VISUAL_ID) ?? listVisualMaterials()[0];
          if (!visual) throw new Error('No visual materials are installed.');
          const sound = getSoundMaterial(DEFAULT_SOUND_ID) ?? listSoundMaterials()[0];
          const res = RENDER_RESOLUTIONS[settings.renderResolution];
          const fresh = freshComposition({
            id: newId(),
            now: nowIso(),
            seed: newSeed(),
            signature,
            visual: visual.meta,
            sound: sound?.meta,
            render: { width: res.width, height: res.height, fps: settings.renderFps },
          });
          let restored = restorableComposition(await loadWorkingState(key), target);
          // Work that has since been saved is in the library, not "new" any more.
          if (restored && (await getComposition(restored.id))) restored = null;
          if (token !== loadToken) return;
          const notices = restored
            ? [
                notice(
                  'info',
                  'Restored the composition you were making from this signature.',
                  'discard',
                ),
              ]
            : [];
          startSession(target, signature, restored ?? fresh, fresh, true, notices, quality);
          return;
        }

        const saved = await getComposition(target.compositionId);
        if (token !== loadToken) return;
        if (!saved) {
          fail('missing-composition', null);
          return;
        }
        const signature = await findSignatureForComposition(saved);
        if (token !== loadToken) return;
        if (!signature) {
          fail('missing-signature', null, { name: saved.signature.name });
          return;
        }
        // Found under another id (the same movement, imported again): point at it.
        const pointed: Composition =
          signature.id === saved.signature.id
            ? saved
            : {
                ...saved,
                signature: {
                  id: signature.id,
                  contentHash: signature.contentHash,
                  name: signature.name,
                },
              };
        const working = restorableComposition(await loadWorkingState(key), target);
        if (token !== loadToken) return;
        const restored = working && compositionsDiffer(working, pointed) ? working : null;
        const composition = restored ?? pointed;
        const notices: StudioNotice[] = [];
        if (restored) notices.push(notice('info', 'Restored changes you hadn’t saved.', 'discard'));
        const changed = materialVersionChanges(composition, {
          visual: registryCatalog.visual(composition.visual.materialId),
          sound: registryCatalog.sound(composition.sound.materialId),
        });
        if (changed.visual || changed.sound) notices.push(notice('info', MATERIAL_CHANGED));
        const albumId = composition.chance?.albumId;
        const album = albumId ? await getAlbum(albumId).catch(() => undefined) : undefined;
        if (token !== loadToken) return;
        startSession(
          target,
          signature,
          composition,
          pointed,
          false,
          notices,
          quality,
          album ? { id: album.id, title: album.title } : null,
        );
      } catch (error) {
        if (token !== loadToken) return;
        console.error('The Studio could not open:', errorDetail(error));
        fail('failed', userMessage(error));
      }
    },

    async leave() {
      // Next time the Studio opens it reads the library again (the composition may have been
      // renamed or deleted meanwhile); unsaved work comes back from the autosave.
      loadToken++;
      history = null;
      set({
        status: 'idle',
        target: null,
        signature: null,
        album: null,
        composition: null,
        baseline: null,
        snapshots: {},
        activeSlot: null,
        notices: [],
        transport: EMPTY_TRANSPORT,
        clipOpacity: 0,
        clipFailed: false,
        presentation: false,
        renderOpen: false,
        chanceOpen: false,
        controller: null,
      });
      await autosave.flush();
    },

    setQuality: (quality) => set({ quality }),
    setClipOpacity: (opacity) =>
      set({ clipOpacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 0 }),
    clipFailedToPlay: () => {
      const hash = get().signature?.contentHash;
      if (hash) forgetVisitClip(hash);
      set({ clipOpacity: 0, clipFailed: true });
    },

    attachController: (controller) => set({ controller }),
    detachController: (controller) => {
      if (get().controller === controller) set({ controller: null });
    },
    runtimeEvents: {
      // The first-visit tip says to press Play: once it plays, the tip has done its work.
      transport: (transport) =>
        set((s) =>
          transport.playing && s.notices.some((n) => n.action === 'tip')
            ? { transport, notices: s.notices.filter((n) => n.action !== 'tip') }
            : { transport },
        ),
      timeline: (timeline) => set({ timeline }),
      picture: (picture) => set({ picture }),
      sound: (sound) => set({ sound }),
    },

    togglePlay: () => get().controller?.togglePlay(),
    setLoop: (loop) => {
      set({ loop });
      get().controller?.setLoop(loop);
    },
    seek: (t, phase) => get().controller?.scrub(t, phase),

    setProperty: (field, id, value, gesture) => {
      const state = present();
      if (!state) return;
      commit(editProperty(state, field, id, value, defsOf(state, registryCatalog)), gesture);
    },
    setMaterial: (field, materialId) => {
      const state = present();
      const meta = registryCatalog[field](materialId);
      if (!state || !meta) return;
      commit(switchMaterial(state, field, meta, registryCatalog));
    },
    setLinked: (linked) => {
      const state = present();
      if (!state) return;
      commit(editLinked(state, linked, defsOf(state, registryCatalog)));
    },
    setTimeline: (patch, gesture) => {
      const state = present();
      if (!state) return;
      commit(editTimeline(state, patch), gesture);
    },
    setSeed: (seed) => {
      const state = present();
      if (!state) return;
      commit(editSeed(state, seed));
    },
    rollSeed: () => get().setSeed(newSeed()),
    toggleMute: (field) => {
      const state = present();
      if (state) commit(toggleMute(state, field));
    },
    toggleSolo: (field) => {
      const state = present();
      if (state) commit(toggleSolo(state, field));
    },
    unlock: (id) => {
      const state = present();
      if (state) commit(unlockProperty(state, id));
    },
    drawChance: () => {
      const state = present();
      if (!state) return false;
      const { chance } = get();
      const visualPool = chanceVisualMetas()
        .filter((m) => chance.visualPool.includes(m.id))
        .map(choiceInfo);
      const installedSound = chanceSoundMetas();
      const soundPool =
        installedSound.length > 0
          ? installedSound.filter((m) => chance.soundPool.includes(m.id)).map(choiceInfo)
          : [{ id: state.sound.materialId, sharedIds: [] }];
      if (visualPool.length === 0 || soundPool.length === 0) return false;
      const draw = drawByChance({
        seed: state.seed,
        visualPool,
        soundPool,
        openCount: chance.openCount,
        chooseValues: chance.chooseValues,
      });
      commit(applyChanceDraw(state, draw, registryCatalog));
      return true;
    },
    setChanceOptions: (patch) => set((s) => ({ chance: { ...s.chance, ...patch } })),
    setChanceOpen: (chanceOpen) => set({ chanceOpen }),
    attachChancePopover: (chancePopover) => set({ chancePopover }),
    detachChancePopover: (handle) => {
      if (get().chancePopover === handle) set({ chancePopover: null, chanceOpen: false });
    },
    toggleChance: () => get().chancePopover?.toggle(),

    undo: () => {
      const { composition } = get();
      const h = history;
      if (!composition || !h?.canUndo) return;
      const state = h.undo();
      set({ composition: rewoken(composition, state), canUndo: h.canUndo, canRedo: h.canRedo });
    },
    redo: () => {
      const { composition } = get();
      const h = history;
      if (!composition || !h?.canRedo) return;
      const state = h.redo();
      set({ composition: rewoken(composition, state), canUndo: h.canUndo, canRedo: h.canRedo });
    },
    storeSnapshot: (slot) => {
      const state = present();
      if (!state) return;
      set((s) => ({
        snapshots: { ...s.snapshots, [slot]: structuredClone(state) },
        activeSlot: slot,
      }));
    },
    recallSnapshot: (slot) => {
      const snap = get().snapshots[slot];
      const state = present();
      if (!snap || !state) return;
      if (JSON.stringify(snap) !== JSON.stringify(state)) commit(structuredClone(snap));
      set({ activeSlot: slot });
    },

    rename: (name) => {
      const cleaned = name.replace(/\s+/g, ' ').trim();
      if (cleaned) editText({ name: cleaned });
    },
    setNotes: (notes) => editText({ notes }),
    setStatus: (status) => editText({ status }),

    async save() {
      const { composition, target, saving, isNew } = get();
      if (!composition || !target || saving) return false;
      set({ saving: true });
      try {
        const saved = await store(composition);
        await settleAutosave();
        await clearWorkingState(workingKey(target));
        const nextTarget: StudioTarget = { kind: 'composition', compositionId: saved.id };
        if (targetKey(nextTarget) !== targetKey(target)) {
          await clearWorkingState(workingKey(nextTarget));
        }
        const now = get().composition;
        // Keep edits made while saving; otherwise show exactly what was stored.
        const unchanged = !now || now === composition;
        if (unchanged) history?.replace(wakeOf(saved));
        set({
          composition: unchanged
            ? saved
            : { ...now, updatedAt: saved.updatedAt, thumbnail: saved.thumbnail },
          baseline: saved,
          isNew: false,
          target: nextTarget,
          saving: false,
        });
        if (isNew) {
          navigate(`/studio/${encodeURIComponent(saved.id)}`, { replace: true });
          // Its first save: say where it went and what could come next (a new composition
          // is saved for the first time only once, so this never repeats for it).
          if (await guidanceOn()) {
            const next = notice('success', nextStepsText(saved.signature.name), 'next');
            set((s) =>
              s.composition?.id === saved.id
                ? { notices: [...s.notices.filter((n) => n.action !== 'tip'), next] }
                : {},
            );
          }
        }
        return true;
      } catch (error) {
        console.error('Save failed:', errorDetail(error));
        set((s) => ({
          saving: false,
          notices: [...s.notices, notice('error', userMessage(error))],
        }));
        return false;
      }
    },

    async saveAsNew() {
      const { composition, target, saving } = get();
      if (!composition || !target || saving) return false;
      set({ saving: true });
      try {
        const now = nowIso();
        const copy: Composition = {
          ...composition,
          id: newId(),
          name: saveAsNewName(composition.name),
          createdAt: now,
          updatedAt: now,
        };
        const saved = await store(copy);
        await settleAutosave();
        // The unsaved changes now live in the copy; the original stays as it was saved.
        await clearWorkingState(workingKey(target));
        const nextTarget: StudioTarget = { kind: 'composition', compositionId: saved.id };
        set((s) => ({
          composition: saved,
          baseline: saved,
          isNew: false,
          target: nextTarget,
          saving: false,
          notices: [
            ...s.notices.filter((n) => n.action !== 'discard'),
            notice('success', `Saved as a new composition, “${saved.name}”.`),
          ],
        }));
        if (history) history.replace(wakeOf(saved));
        navigate(`/studio/${encodeURIComponent(saved.id)}`);
        return true;
      } catch (error) {
        console.error('Save as new failed:', errorDetail(error));
        set((s) => ({
          saving: false,
          notices: [...s.notices, notice('error', userMessage(error))],
        }));
        return false;
      }
    },

    async discardChanges() {
      const { baseline, target } = get();
      if (!baseline || !target) return;
      history = new UndoHistory<WakeState>(wakeOf(baseline));
      set((s) => ({
        composition: baseline,
        canUndo: false,
        canRedo: false,
        activeSlot: null,
        notices: s.notices.filter((n) => n.action !== 'discard'),
      }));
      try {
        await settleAutosave();
        await clearWorkingState(workingKey(target));
      } catch (error) {
        console.warn('Could not clear the autosave:', errorDetail(error));
      }
    },

    dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),

    setPresentation: (presentation) => {
      if (presentation === get().presentation) return;
      if (presentation) get().chancePopover?.close();
      set({ presentation });
      usePresentationStore.getState().setActive(presentation);
    },
    renderClosed: (fileName) => {
      set({ renderOpen: false });
      // The Library's "How it works" counts a finished render as its last step.
      if (fileName) {
        setSetting('videoRendered', true).catch((error: unknown) => {
          console.warn('Could not note the render for the Library:', errorDetail(error));
        });
      }
      const composition = get().composition;
      const albumId = composition?.chance?.albumId;
      if (!fileName || !composition || !albumId) return;
      // The album log records each track's render.
      setAlbumRender(albumId, composition.id, fileName).catch((error: unknown) => {
        console.warn('The album could not note the render:', errorDetail(error));
        set((s) => ({
          notices: [
            ...s.notices,
            notice('warning', `Rendered “${fileName}”, but the album’s log couldn’t note it.`),
          ],
        }));
      });
    },
    setRenderOpen: (renderOpen) => {
      if (renderOpen) {
        get().controller?.pause();
        get().chancePopover?.close();
        // Rendering is the next step the after-save note suggests: it can go.
        set((s) => ({ notices: s.notices.filter((n) => n.action !== 'next') }));
      }
      set({ renderOpen });
    },

    async showFirstVisitTip() {
      if (tipOffered) return;
      tipOffered = true;
      try {
        const [show, seen] = await Promise.all([guidanceOn(), getSetting('studioTipSeen')]);
        if (!show || seen) return;
        await setSetting('studioTipSeen', true);
      } catch (error) {
        console.warn('The Studio tip could not check its setting:', errorDetail(error));
        return;
      }
      const s = get();
      if (s.status !== 'ready' || s.transport.playing) return;
      set({ notices: [...s.notices, notice('info', FIRST_VISIT_TIP, 'tip')] });
    },
  };
});

// Autosave: a moment after each change to the working composition (SPEC 11.1). Unchanged
// work (as saved, or a new composition nobody has touched) clears the record instead.
useStudioStore.subscribe((state, prev) => {
  if (state.composition === prev.composition || state.session !== prev.session) return;
  if (state.status !== 'ready' || state.saving) return;
  if (!state.composition || !state.target || !state.baseline) return;
  const changed = compositionsDiffer(state.composition, state.baseline);
  autosave.schedule({
    key: workingKey(state.target),
    composition: changed ? state.composition : null,
  });
});

/** Write any pending autosave now (the page is hiding or closing). */
export function flushStudioAutosave(): Promise<void> {
  return autosave.flush();
}
