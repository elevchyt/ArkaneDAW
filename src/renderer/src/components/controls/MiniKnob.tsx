import { Knob, type KnobProps } from './Knob'

/** The tiny knobs in the channel rack (vol/pan). */
export function MiniKnob(props: Omit<KnobProps, 'size'>) {
  return <Knob size={18} labelPosition="none" color="var(--fl-green)" {...props} />
}
