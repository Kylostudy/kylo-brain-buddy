import React from 'react';
import {Composition,registerRoot} from 'remotion';
import {Universal} from './Composition';
const Root=()=> <Composition id="UniversalExam" component={Universal} width={1080} height={1920} fps={30} durationInFrames={30} calculateMetadata={({props})=>({durationInFrames:props.total_frames})}/>;
registerRoot(Root);