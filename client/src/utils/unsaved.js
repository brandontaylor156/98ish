// Documents with unsaved changes (Notepad, Paint...), so shutting down can warn first.
// An open document calls trackUnsaved("Notepad") while it has changes and the returned
// function once they're saved or discarded.
const unsaved = new Map()

export const trackUnsaved = (program) => {
  const token = {}
  unsaved.set(token, program)
  return () => unsaved.delete(token)
}

export const hasUnsaved = () => unsaved.size > 0

// "Notepad", "Notepad and Paint"...
export const unsavedPrograms = () => {
  const names = [...new Set(unsaved.values())]
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] || ""
}
