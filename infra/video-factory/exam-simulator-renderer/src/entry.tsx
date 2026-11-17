import React from 'react';
import {Composition, registerRoot} from 'remotion';
import {ExamSimulator} from './Composition';
import {SIM_DESIGN_FRAMES, validateSceneFrames} from './timing';
import type {Props} from './types';
const defaults: Props = {sceneFrames: SIM_DESIGN_FRAMES, screens: ['', '', '', ''], subs: [], logo: 'brand/kylo-dog.png'};
function Root() {
  return <Composition id="ExamSimulator" component={ExamSimulator} width={1080} height={1920} fps={30} durationInFrames={900} defaultProps={defaults} calculateMetadata={({props}) => ({durationInFrames: validateSceneFrames(props.sceneFrames).reduce((a, b) => a + b, 0)})}/>;
}
registerRoot(Root);
