import { useEffect, useState } from 'react'
import { Minus, Square, Copy, X } from 'lucide-react'
import { host } from '@/platform'

export function WindowControls() {
  const [max, setMax] = useState(false)
  useEffect(() => {
    if (!host) return
    void host.window.isMaximized().then(setMax)
    return host.window.onState((s) => setMax(s.maximized))
  }, [])
  if (!host) return null
  const cls = 'grid h-6 w-8 place-items-center rounded-sm text-[#c5cdd1] hover:bg-white/10'
  return (
    <div className="flex items-start gap-0.5 pt-0.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <button className={cls} onClick={() => host!.window.minimize()} title="Minimize">
        <Minus size={13} />
      </button>
      <button className={cls} onClick={() => host!.window.toggleMaximize()} title="Maximize">
        {max ? <Copy size={11} /> : <Square size={11} />}
      </button>
      <button className={`${cls} hover:!bg-[#c8463f]`} onClick={() => host!.window.close()} title="Close">
        <X size={14} />
      </button>
    </div>
  )
}
