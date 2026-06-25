import { useDiagramStore } from '@/store/diagramStore'

export const Footer = () => {
  const parseResult = useDiagramStore((s) => s.parseResult)
  const routed = useDiagramStore((s) => s.routed)
  const gridSize = useDiagramStore((s) => s.gridSize)

  const nodeCount = routed?.nodes.length ?? 0
  const edgeCount = routed?.edges.length ?? 0
  const areaCount = routed?.areas.length ?? 0
  const errorCount = parseResult.ok ? 0 : parseResult.errors.length

  return (
    <footer className="ag-footer">
      <span>
        {nodeCount} nodes · {edgeCount} edges · {areaCount}{' '}
        {areaCount === 1 ? 'group' : 'groups'}
      </span>
      {errorCount > 0 ? (
        <>
          <span className="ag-footer-sep">·</span>
          <span className="ag-footer-error">
            <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path
                d="M6 1 L11 11 L1 11 Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
                fill="none"
              />
              <path d="M6 5 V8 M6 9.5 V9.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            {errorCount} {errorCount === 1 ? 'error' : 'errors'}
          </span>
        </>
      ) : null}
      <div className="ag-spacer" />
      <span>grid {gridSize}px</span>
      <span className="ag-footer-sep">·</span>
      <span>d2 v0.7</span>
      <span className="ag-footer-sep">·</span>
      <span>UTF-8</span>
      <span className="ag-footer-sep">·</span>
      <span>LF</span>
    </footer>
  )
}
