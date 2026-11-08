export type Text = {heading: string; disclaimer: string; truth: string; price: string; unit: string; steps: string[]; counter_values: number[]; labels: string[]; outro_url: string; outro_tagline: string};
export type Subtitle = {start_ms: number; end_ms: number; text: string};
export type Props = {sceneFrames: number[]; language: string; dir: 'ltr' | 'rtl'; text: Text; subs: Subtitle[]; cta: {text: string; supporting_text: string; trial_days: number}; audio: string; coins?: string; coinHits: number[]; bed?: string};
