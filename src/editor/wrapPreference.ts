import { useCallback, useState } from 'react'

// Soft line wrapping in the code pane (both tabs). A UI preference, not part
// of the document, so it lives in its own localStorage key; off by default.
export const EDITOR_WRAP_KEY = 'epure:ui:editor-wrap:v1'

export const loadEditorWrap = (): boolean => {
  try {
    return localStorage.getItem(EDITOR_WRAP_KEY) === '1'
  } catch {
    return false
  }
}

const saveEditorWrap = (wrap: boolean) => {
  try {
    localStorage.setItem(EDITOR_WRAP_KEY, wrap ? '1' : '0')
  } catch {
    // Storage unavailable (private mode, quota): the preference just won't stick.
  }
}

/** The persisted wrap preference and its toggle. */
export const useEditorWrap = (): [boolean, () => void] => {
  const [wrap, setWrap] = useState(loadEditorWrap)
  const toggle = useCallback(() => {
    setWrap((w) => {
      saveEditorWrap(!w)
      return !w
    })
  }, [])
  return [wrap, toggle]
}
