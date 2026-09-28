import styles from './LibraryScreen.module.css';

/** Home screen. Placeholder until Milestone 1 brings signatures and clips. */
export function LibraryScreen() {
  return (
    <section className={styles.page}>
      <h1>Library</h1>
      <div className={styles.empty}>
        <p className={styles.lead}>Bring in a clip to make your first signature.</p>
        <p className={styles.hint}>Importing clips arrives with the next milestone.</p>
      </div>
    </section>
  );
}
