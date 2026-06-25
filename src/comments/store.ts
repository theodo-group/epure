// Comments live in their own store, deliberately separate from the diagram
// store so pins never enter the zundo undo history (Cmd-Z must not toggle a
// comment). The bridge syncs this slice to `<name>.epr.comments.json`.

import { create } from 'zustand'

import type { CommentStatus, CommentTarget, EprComment } from './types'

const newId = (): string =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)

const nowIso = (): string => new Date().toISOString()

interface CommentsState {
  comments: EprComment[]
  /** When on, clicking the canvas drops a pin instead of selecting. */
  commentMode: boolean
  /** Comment focused in the panel (for editing). */
  selectedId: string | null
}

interface CommentsActions {
  /** Replace the whole list (inbound from disk/bridge). */
  setComments: (comments: EprComment[]) => void
  /** Create an open comment at a target; returns its id and selects it. */
  addComment: (target: CommentTarget, body?: string) => string
  updateBody: (id: string, body: string) => void
  setStatus: (id: string, status: CommentStatus) => void
  removeComment: (id: string) => void
  selectComment: (id: string | null) => void
  setCommentMode: (on: boolean) => void
}

export const useCommentsStore = create<CommentsState & CommentsActions>((set) => ({
  comments: [],
  commentMode: false,
  selectedId: null,

  setComments: (comments) => set({ comments }),

  addComment: (target, body = '') => {
    const comment: EprComment = {
      id: newId(),
      body,
      status: 'open',
      createdAt: nowIso(),
      author: 'user',
      target,
    }
    set((s) => ({ comments: [...s.comments, comment], selectedId: comment.id }))
    return comment.id
  },

  updateBody: (id, body) =>
    set((s) => ({
      comments: s.comments.map((c) => (c.id === id ? { ...c, body } : c)),
    })),

  setStatus: (id, status) =>
    set((s) => ({
      comments: s.comments.map((c) => (c.id === id ? { ...c, status } : c)),
    })),

  removeComment: (id) =>
    set((s) => ({
      comments: s.comments.filter((c) => c.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),

  selectComment: (id) => set({ selectedId: id }),

  setCommentMode: (on) => set({ commentMode: on }),
}))
