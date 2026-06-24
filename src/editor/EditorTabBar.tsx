interface Tab {
  id: string
  label: string
  dirty?: boolean
}

interface EditorTabBarProps {
  tabs: Tab[]
  activeTabId: string
  onSelectTab: (id: string) => void
  onSearch?: () => void
}

export const EditorTabBar = ({
  tabs,
  activeTabId,
  onSelectTab,
  onSearch,
}: EditorTabBarProps) => (
  <div className="ag-tabbar" role="tablist">
    {tabs.map((tab) => {
      const active = tab.id === activeTabId
      return (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active}
          className={`ag-tab${active ? '' : ' ag-tab-inactive'}`}
          onClick={() => onSelectTab(tab.id)}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M3 2 L10 2 L13 5 L13 14 L3 14 Z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
            <path d="M10 2 V5 H13" stroke="currentColor" strokeWidth="1.3" />
          </svg>
          <span>{tab.label}</span>
          {tab.dirty ? (
            <span className="ag-tab-dirty" aria-label="unsaved changes" />
          ) : null}
        </button>
      )
    })}
    <div className="ag-tab-actions">
      <button className="ag-tab-action" title="Wrap" type="button">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M2 4 H14 M2 8 H11 a2 2 0 0 1 0 4 H8 M10 10 L8 12 L10 14"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button className="ag-tab-action" title="Format" type="button">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M3 3 H13 M3 8 H13 M3 13 H9"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <button
        className="ag-tab-action"
        title="Search (⌘F)"
        type="button"
        onClick={onSearch}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M10.5 10.5 L14 14"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  </div>
)
