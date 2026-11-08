import React from 'react';
import {Composition, registerRoot} from 'remotion';
import {PiggyBank} from './Composition';
import {validateSceneFrames} from './timing';
import type {Props} from './types';
const defaults: Props = {sceneFrames: [120,300,120,300,150,90,90], text: {heading:'',disclaimer:'',truth:'',price:'',steps:[],counter_values:[],labels:[],outro_url:'',outro_tagline:''}, cta: {text:'',supporting_text:'',trial_days:14},subs:[],audio:''};
function Root() {
  return <Composition id="PiggyBank" component={PiggyBank} width={1080} height={1920} fps={30} durationInFrames={1170} defaultProps={defaults} calculateMetadata={({props}) => ({durationInFrames: validateSceneFrames(props.sceneFrames).reduce((a,b)=>a+b,0)})}/>;
}
registerRoot(Root);