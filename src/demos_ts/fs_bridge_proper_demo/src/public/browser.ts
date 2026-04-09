

export async function debugPersist() {
  try {
    const granted = await navigator.storage.persist();
    console.log("OPFS persist requested →", granted);
  } catch (err) {
    console.warn("OPFS persist attempt failed", err);
  }
}

debugPersist();
