import type { ParamDef } from '@/plugins/sdk/types'
import { denormalize, formatParam, normalize } from '@/plugins/sdk/params'
import { Knob, type KnobProps } from './Knob'

export interface ParamKnobProps extends Omit<KnobProps, 'value' | 'onChange' | 'hint' | 'onReset'> {
  def: ParamDef
  value: number
  onChange: (value: number) => void
}

/** Knob bound to a ParamDef: handles curves, formatting and reset-to-default. */
export function ParamKnob({ def, value, onChange, label, ...rest }: ParamKnobProps) {
  return (
    <Knob
      value={normalize(def, value)}
      onChange={(x) => onChange(denormalize(def, x))}
      onReset={() => onChange(def.default)}
      hint={`${def.name}: ${formatParam(def, value)}`}
      label={label ?? def.name}
      bipolar={def.min < 0 && def.max > 0}
      {...rest}
    />
  )
}
