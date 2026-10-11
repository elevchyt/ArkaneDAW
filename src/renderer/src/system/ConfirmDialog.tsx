// Generic "Are you sure?" modal. confirmAction() resolves true when the user confirms.
import { create } from 'zustand'
import { DlgButton, FlDialog } from './FlDialog'

interface Request {
  title: string
  message: React.ReactNode
  detail?: React.ReactNode
  confirmLabel: string
  resolve: (ok: boolean) => void
}

const useConfirm = create<{ req: Request | null }>(() => ({ req: null }))

export function confirmAction(opts: { title: string; message: React.ReactNode; detail?: React.ReactNode; confirmLabel?: string }): Promise<boolean> {
  useConfirm.getState().req?.resolve(false)
  return new Promise((resolve) => useConfirm.setState({ req: { confirmLabel: 'OK', ...opts, resolve } }))
}

function finish(ok: boolean): void {
  const r = useConfirm.getState().req
  useConfirm.setState({ req: null })
  r?.resolve(ok)
}

/** Mounted once in App. */
export function ConfirmDialog() {
  const req = useConfirm((s) => s.req)
  return (
    <FlDialog
      open={!!req}
      onClose={() => finish(false)}
      title={req?.title ?? ''}
      width={380}
      label={req?.title}
      footer={
        <>
          <div className="flex-1" />
          <DlgButton primary onClick={() => finish(true)}>
            {req?.confirmLabel ?? 'OK'}
          </DlgButton>
          <DlgButton onClick={() => finish(false)}>Cancel</DlgButton>
        </>
      }
    >
      <div className="break-words px-1 py-2 leading-[1.5]">
        {req?.message}
        {req?.detail && <div className="mt-1 text-[10px] text-fl-dim">{req.detail}</div>}
      </div>
    </FlDialog>
  )
}
