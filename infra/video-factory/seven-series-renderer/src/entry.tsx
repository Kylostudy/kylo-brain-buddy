import React from 'react';
import {Composition, registerRoot} from 'remotion';
import {SevenStoriesMaster} from './SevenStoriesMaster';
import {sceneAt} from './timing';
import type {MasterProps} from './theme';

const defaults: MasterProps = {story:'hajo',sceneFrames:[162,59,74,87,82,69,163],dogAsset:'brand/kylo-dog.png',subtitles:[],direction:'ltr',cta:'',slogan:'',toolLabels:[]};
function Root() {
  return <Composition id="SevenStories" component={SevenStoriesMaster} width={1080} height={1920} fps={30}
    durationInFrames={696} defaultProps={defaults} calculateMetadata={({props}) => {
      sceneAt(0,props.sceneFrames);
      return {durationInFrames:props.sceneFrames.reduce((a,b)=>a+b,0),props};
    }}/>;
}
registerRoot(Root);