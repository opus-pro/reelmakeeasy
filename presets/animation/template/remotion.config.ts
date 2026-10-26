import { Config } from '@remotion/cli/config'

// Written by ReelMakeEasy for a Claude Animation. JPEG frames render faster; the video is encoded
// as H.264. ANGLE draws WebGL (the 3D and 8-bit looks) the same way in every headless render.
Config.setVideoImageFormat('jpeg')
Config.setOverwriteOutput(true)
Config.setCodec('h264')
Config.setChromiumOpenGlRenderer('angle')
