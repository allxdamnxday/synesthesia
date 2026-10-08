import { Fragment } from 'react';
import { href } from '../../app/router';
import { GUIDE_SECTIONS, guidePath, type GuideSectionSlug } from '../../guide/sections';
import { SHARED_PROPERTIES, SHARED_PROPERTY_IDS } from '../../materials/properties';
import { listSoundMaterials, listVisualMaterials } from '../../materials/registry';
import type { MaterialMeta } from '../../materials/types';
import styles from './HelpScreen.module.css';

function isMac(): boolean {
  const uaPlatform = (navigator as Navigator & { userAgentData?: { platform?: string } })
    .userAgentData?.platform;
  return uaPlatform === 'macOS' || /Mac/i.test(navigator.userAgent);
}

const SECTIONS = [
  { id: 'idea', title: 'The idea' },
  { id: 'workflow', title: 'How a session goes' },
  { id: 'words', title: 'Words used here' },
  { id: 'properties', title: 'Properties' },
  { id: 'materials', title: 'Materials' },
  { id: 'shortcuts', title: 'Keyboard shortcuts' },
  { id: 'trouble', title: 'If something goes wrong' },
  { id: 'about', title: 'About' },
];

/** The guide's sections for "How a session goes", in the order a session uses them. */
const SESSION_GUIDE: readonly GuideSectionSlug[] = [
  'library',
  'prepare',
  'studio',
  'render',
  'albums',
];

const WORDS: Array<[string, string]> = [
  [
    'Clip',
    'The video you bring in. You see it on the Prepare screen and, if you raise the Clip slider, over the wake in the Studio until you close or reload the page. It is never kept.',
  ],
  [
    'Signature',
    'The movement taken from a clip: where things moved, how fast, in which direction, and when. No picture of the clip is kept.',
  ],
  ['Material', 'Something the signature acts on. Visual materials draw; sound materials sound.'],
  ['Property', 'A control that shapes how a material responds, such as its viscosity.'],
  [
    'Shared property',
    'A property that means the same thing for sight and sound, so one slider can move both.',
  ],
  ['Baseline', "A material's starting values. Every composition starts from them."],
  ['Wake', 'Everything you see and hear when the signature moves through the materials.'],
  [
    'Composition',
    'One signature with one visual material, one sound material, their property values, a seed, and your notes.',
  ],
  [
    'Seed',
    'A six-digit number that fixes every chance choice, so a composition always replays the same way.',
  ],
  [
    'Snapshot',
    'A quick slot (A, B, C or D) that holds a version of the composition for comparison.',
  ],
  ['Album', 'A set of compositions drawn from one signature, with a written record of each.'],
  ['Render', 'Turning a composition into an MP4 video file, frame by frame.'],
];

function MaterialList({ title, materials }: { title: string; materials: readonly MaterialMeta[] }) {
  if (materials.length === 0) {
    return (
      <div className={styles.materialGroup}>
        <h3>{title}</h3>
        <p className={styles.muted}>No materials of this kind are installed yet.</p>
      </div>
    );
  }
  return (
    <div className={styles.materialGroup}>
      <h3>{title}</h3>
      {materials.map((m) => (
        <details key={m.id} className={styles.material}>
          <summary>
            <span className={styles.materialName}>{m.name}</span>
            <span className={styles.materialDescription}>{m.description}</span>
          </summary>
          <dl className={styles.propertyList}>
            {m.properties.map((p) => (
              <div key={p.id} className={styles.propertyRow}>
                <dt>
                  {p.label}
                  {p.kind === 'choice' && p.choices ? (
                    <span className={styles.muted}> ({p.choices.join(', ')})</span>
                  ) : null}
                </dt>
                <dd>{p.description}</dd>
              </div>
            ))}
          </dl>
        </details>
      ))}
    </div>
  );
}

export function HelpScreen() {
  const mod = isMac() ? 'Cmd' : 'Ctrl';
  const shortcuts: Array<[string, string]> = [
    ['Space', 'Play or pause'],
    ['L', 'Loop on or off'],
    ['1 – 4', 'Recall snapshot A – D'],
    ['Shift + 1 – 4', 'Store snapshot A – D'],
    ['C', 'Draw by chance'],
    ['S', 'Save'],
    ['R', 'Render MP4'],
    ['F', 'Present: only the wake, full screen (the Present button does the same)'],
    ['Esc', 'Leave presentation mode'],
    [`${mod} + Z`, 'Undo'],
    [`Shift + ${mod} + Z`, 'Redo'],
  ];
  const visual = listVisualMaterials().map((e) => e.meta);
  const sound = listSoundMaterials().map((e) => e.meta);

  return (
    <div className={styles.layout}>
      <nav className={styles.toc} aria-label="Help contents">
        <p className={styles.tocTitle}>Help</p>
        <ul>
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#/help`}
                onClick={(e) => {
                  e.preventDefault();
                  document
                    .getElementById(s.id)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
              >
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <article className={styles.article}>
        <section id="idea">
          <h1>The idea</h1>
          <p className={styles.lead}>
            Picture lying at the bottom of a bowl of colored water, looking up. A finger traces a
            path through the water above. You never see the finger, only its wake.
          </p>
          <div className={styles.guideCallout}>
            <p>
              <strong>New here?</strong> The guide goes through every screen, step by step, with
              pictures.
            </p>
            <a className={styles.guideButton} href={href(guidePath())}>
              Read the guide
            </a>
          </div>
          <p>
            Synesthesia keeps the movement from a short clip as a <strong>signature</strong>: where
            things moved, how fast, in which direction, and when. The clip itself disappears. The
            same signature can then move through different materials, such as water or honey, and
            through different sounds. The movement stays the same; the response changes.
          </p>
          <p>
            Nothing here labels or interprets a movement. You are the only authority on what, if
            anything, becomes noticeable.
          </p>
        </section>

        <section id="workflow">
          <h2>How a session goes</h2>
          <ol className={styles.steps}>
            <li>
              <strong>Bring in a clip.</strong> On the Library screen, choose <em>New from clip</em>{' '}
              and drop in a short video (up to a minute).
            </li>
            <li>
              <strong>Prepare it.</strong> Trim the start and end, turn or mirror it, and, if you
              like, draw a box around the part that moves (an eye, for a wink).
            </li>
            <li>
              <strong>Extract the signature.</strong> Choose <em>Extract signature</em>. When
              it&apos;s done you&apos;ll see the bare wake: the movement on its own, with the clip
              hidden. Name it and save it.
            </li>
            <li>
              <strong>Open it in the Studio.</strong> Choose a visual material and a sound material,
              press play, and adjust their properties while you watch and listen. To see the clip
              over its wake, raise <em>Clip</em> at the top of the controls (it is there until you
              close or reload the page).
            </li>
            <li>
              <strong>Compare.</strong> Store versions in snapshots A to D and switch between them
              while it plays. Try another material with the same movement. To watch with nothing
              else on screen, choose <em>Present</em> (or press F); Esc comes back.
            </li>
            <li>
              <strong>Keep what you find.</strong> Save the composition with notes, and render it as
              an MP4 video. An album gathers many compositions from one signature.
            </li>
          </ol>
          <p className={styles.guideLinks}>
            Each step in more detail, with pictures, in the guide:{' '}
            {SESSION_GUIDE.map((slug, i) => (
              <Fragment key={slug}>
                {i === 0 ? null : i === SESSION_GUIDE.length - 1 ? ' and ' : ', '}
                <a href={href(guidePath(slug))}>{GUIDE_SECTIONS[slug]}</a>
              </Fragment>
            ))}
            .
          </p>
        </section>

        <section id="words">
          <h2>Words used here</h2>
          <dl className={styles.glossary}>
            {WORDS.map(([term, meaning]) => (
              <div key={term} className={styles.glossaryRow}>
                <dt>{term}</dt>
                <dd>{meaning}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section id="properties">
          <h2>Properties</h2>
          <p>
            These properties mean the same thing for sight and sound. With <em>Linked</em> on (the
            usual way), one slider moves both. Every property runs from 0 to 1, and each material
            starts from its own baseline. Double-click a slider to return it to the baseline; hold
            Shift while dragging for fine control.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Property</th>
                  <th scope="col">What you see</th>
                  <th scope="col">What you hear</th>
                </tr>
              </thead>
              <tbody>
                {SHARED_PROPERTY_IDS.map((id) => {
                  const p = SHARED_PROPERTIES[id];
                  return (
                    <tr key={id}>
                      <th scope="row">{p.label}</th>
                      <td>{p.visual}</td>
                      <td>{p.sound}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section id="materials">
          <h2>Materials</h2>
          <p>Open a material to see what each of its properties does.</p>
          <MaterialList title="Visual materials" materials={visual} />
          <MaterialList title="Sound materials" materials={sound} />
        </section>

        <section id="shortcuts">
          <h2>Keyboard shortcuts</h2>
          <p className={styles.muted}>
            In the Studio. Shortcuts pause while you type in a text box.
          </p>
          <table className={styles.table}>
            <tbody>
              {shortcuts.map(([keys, action]) => (
                <tr key={keys}>
                  <th scope="row">
                    <kbd className={styles.kbd}>{keys}</kbd>
                  </th>
                  <td>{action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section id="trouble">
          <h2>If something goes wrong</h2>
          <ul className={styles.bullets}>
            <li>
              <strong>A clip won&apos;t open.</strong> Some iPhone videos use a format this browser
              can&apos;t read. On the iPhone, set Settings › Camera › Formats › Most Compatible and
              record again, or convert the clip to MP4 (H.264).
            </li>
            <li>
              <strong>Everything is slow.</strong> Lower the preview quality in{' '}
              <a href={href('/settings')}>Settings</a>. Renders always use full quality, however
              long they take.
            </li>
            <li>
              <strong>Keep a backup.</strong> Your work lives in this browser. From the Library,
              choose <em>Back up everything</em> now and then, and keep the file somewhere safe.
            </li>
            <li>
              <strong>Something else.</strong> Open <a href={href('/diagnostics')}>Diagnostics</a>{' '}
              and choose <em>Copy report</em>, then paste it into a message to Braden.
            </li>
          </ul>
        </section>

        <section id="about">
          <h2>About</h2>
          <p>
            Synesthesia is free to use, study and change (the MIT License). It is built with other
            people&apos;s freely shared software and a typeface made to be easy to read:{' '}
            <a href="third-party-notices.txt" target="_blank" rel="noopener">
              read their notices
            </a>
            .
          </p>
        </section>
      </article>
    </div>
  );
}
