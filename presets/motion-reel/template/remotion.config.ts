import { Config } from '@remotion/cli/config'

// Written by ReelMakeEasy for a Motion Reel. JPEG frames render faster; the reel is encoded as H.264.
Config.setVideoImageFormat('jpeg')
Config.setOverwriteOutput(true)
Config.setCodec('h264')
