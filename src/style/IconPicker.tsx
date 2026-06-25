import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'

import {
  PROVIDERS,
  iconById,
  iconUrl,
  iconUrlById,
  searchIcons,
} from '@/icons'

interface IconControlProps {
  /** Current icon id, or undefined (none / mixed selection). */
  value?: string
  /** True when the selection mixes different icons. */
  mixed?: boolean
  onChange: (id: string | undefined) => void
}

const GRID_LIMIT = 300

const Popover = ({
  anchor,
  value,
  onChange,
  onClose,
}: {
  anchor: DOMRect
  value?: string
  onChange: (id: string | undefined) => void
  onClose: () => void
}) => {
  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState<string>(
    value ? (iconById(value)?.provider ?? '') : '',
  )
  const ref = useRef<HTMLDivElement>(null)

  const results = useMemo(
    () => searchIcons(query, { provider: provider || undefined, limit: GRID_LIMIT }),
    [query, provider],
  )

  // Close on outside click or Escape.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const W = 324
  const MAXH = 380
  // Open to the left of the panel; clamp into the viewport.
  const left = Math.max(8, anchor.left - W - 8)
  const top = Math.min(
    Math.max(8, anchor.top),
    window.innerHeight - MAXH - 8,
  )

  return createPortal(
    <div
      ref={ref}
      className="ag-iconpop"
      style={{ left, top, width: W, maxHeight: MAXH }}
    >
      <div className="ag-iconpop-controls">
        <input
          className="ag-iconpop-search"
          type="text"
          placeholder="Search icons…"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="ag-iconpop-provider"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
        >
          <option value="">All</option>
          {PROVIDERS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label} ({p.count})
            </option>
          ))}
        </select>
      </div>
      <div className="ag-iconpop-grid">
        {results.length === 0 ? (
          <div className="ag-iconpop-empty">No icons match.</div>
        ) : (
          results.map((m) => (
            <button
              key={m.id}
              type="button"
              title={`${m.name} · ${m.provider}/${m.category}`}
              className={`ag-iconpop-item${value === m.id ? ' active' : ''}`}
              onClick={() => {
                onChange(m.id)
                onClose()
              }}
            >
              <img src={iconUrl(m.file)} alt={m.name} loading="lazy" />
            </button>
          ))
        )}
      </div>
      <div className="ag-iconpop-foot">
        {results.length >= GRID_LIMIT
          ? `Showing first ${GRID_LIMIT} — refine your search`
          : `${results.length} icon${results.length === 1 ? '' : 's'}`}
      </div>
    </div>,
    document.body,
  )
}

export const IconControl = ({ value, mixed, onChange }: IconControlProps) => {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const openPopover = () => {
    if (btnRef.current) setRect(btnRef.current.getBoundingClientRect())
    setOpen(true)
  }

  // Keep the popover anchored if the window resizes or anything scrolls while
  // it's open. The trigger lives inside the scrollable style panel, whose
  // scroll events don't bubble, so listen in the capture phase.
  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      if (btnRef.current) setRect(btnRef.current.getBoundingClientRect())
    }
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  const meta = value ? iconById(value) : undefined
  const url = value ? iconUrlById(value) : undefined

  return (
    <div className="ag-icon-control">
      <button
        ref={btnRef}
        type="button"
        className="ag-icon-trigger"
        onClick={() => (open ? setOpen(false) : openPopover())}
      >
        {url ? (
          <img className="ag-icon-thumb" src={url} alt="" />
        ) : (
          <span className="ag-icon-thumb ag-icon-thumb-empty" aria-hidden />
        )}
        <span className="ag-icon-trigger-label">
          {meta ? meta.name : mixed ? 'Mixed' : 'Add icon'}
        </span>
      </button>
      {value ? (
        <button
          type="button"
          className="ag-icon-clear"
          title="Remove icon"
          onClick={() => onChange(undefined)}
        >
          ✕
        </button>
      ) : null}
      {open && rect ? (
        <Popover
          anchor={rect}
          value={value}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  )
}
