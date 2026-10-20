import {lathe} from '../world/geom';
/** Outer foot -> outer wall -> lip -> inside. Reversing this contour culls the visible wall and lip with FrontSide stone. */
export function snowFountainBasin(){
 return lathe([[3.14,-.6],[3.14,0],[3.06,.12],[3.06,.6],[2.92,.75],[2.6,.75],[2.46,.62],[2.42,.36]],56,.5);
}
