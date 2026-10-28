import React from 'react';
import {Composition,registerRoot} from 'remotion';
import {Universal} from './Composition';
import type {Props} from './types';
// Metadata is always supplied by the validated VPS request, never a demo render.
const empty:Props={zone:{left:65,right:950,top:231,bottom:1459},exam:{name:'',sections:[],score_scale:'',sample_percent:0,vocabulary:[],skin:{}},scenes:[],audio_ms:0,outro_ms:0,captions:[],font:'',audio:'',dog:'',cta:'',telegram:'',total_frames:30};
const Root=()=> <Composition id="UniversalExam" component={Universal} defaultProps={empty} width={1080} height={1920} fps={30} durationInFrames={30} calculateMetadata={({props})=>({durationInFrames:props.total_frames})}/>;
registerRoot(Root);