// Keeps a crashing plugin editor inside its own window instead of taking down the whole app (React unmounts
// the entire tree on an uncaught render error, leaving a blank screen).
import { Component, type ReactNode } from 'react'

export class EditorBoundary extends Component<{ name: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error(`[plugin editor] ${this.props.name} crashed`, error)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-fl-panel p-4 text-center text-[11px] text-fl-text">
        <div className="text-[13px] font-semibold text-white">The {this.props.name} editor hit an error</div>
        <div className="max-w-[420px] break-words font-mono text-[10px] text-fl-dim">{error.message}</div>
        <button
          className="h-6 rounded-[3px] border border-[#1e2427] bg-[#46525a] px-3 fl-bevel hover:bg-[#515e66]"
          onClick={() => this.setState({ error: null })}
        >
          Reload editor
        </button>
      </div>
    )
  }
}
