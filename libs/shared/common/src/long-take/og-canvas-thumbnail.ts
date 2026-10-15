import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

// 300x300 RGBA play button (semi-transparent disc + white ring + triangle),
// embedded as base64 so it ships with the JS bundle -- no asset-copy build step
// and no runtime fetch. ffmpeg scales it down at composite time.
const OG_ICON_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAASwAAAEsCAYAAAB5fY51AAANJklEQVR4nO3dW47jRhJAUbHhLQ7gNXBBWoOBWSQH9LgwZY9K4iMfkZHnfPjT6Jao25EhSloecMyz8gO1Vv7/k8DS+w/AFDEqRdQmJ1hzGSVMZwnZJAQrr6xxOkrEEhKsPGYP1CcCloBgjUug7hGwAQnWOLoGatu2f9X8/y/L8u9HXwI2AMGK7ZkhRgNGTbyCEqyJIjVKmIKFTLwCEazEocoaqE4BE64ABCtJpGaNU6eIiVcngjVwqESqe7yEqzHBGihSAhU6YOLVgGAFD1WUSNV+hy7R31O4KhKsgKHq8eINcB9UtsdEuCoQrMlCFT1MCR8z4SpIsDqHquYLLlucBn9MhasAwUoUqlkDNdhjLVw3CFbDUAV74Uwp0HMgXBcI1mChEqiyAjw3wnWCYA0QKpFqo/PzJVwHCFaFWJW48EWqr07PoWh9IFjvCdXkhCsWwSoQq7sXtWlqDI2fZ9PWC4LVcaoSqjE1fs6F6xvB+h+h4hThak+wGh7/TFQ5Nbwm1sfkBOtgrISKINfIOvMzMXOwqk9VJqo5Nbpe1seEZg1W1alKqGh0/ayzPdIzBqtarISKDtfSOtOjPlOwhIquhOu+WYJVJVYmKq6oeJ2t2Z+RX4/8xIpQzv5DdyJwz0dymScsoSI809Y5WScssWIIpq1zMk5YxWNlV0ULla7J9ZHIMlusLNaJrNL1uT6SyBSsorEyVdFThWt1fSSQZYclVqRy5h/M7VjcUryDmCFYYkVKopXvSFgsVo6ARFb4Ol4fg1qyxsq+imy2snutIaM16pFQrJjOUnavNeROa5k1Vo6AjGwrd50PNWmNNmGJFTyO/4ObbdIaKVhiBZNHa5RgiRW8MFu0RgiWWMEby0TRih4ssYIDlkmiFTlYYgUnLBNEK2qwxAouWJJHK2KwxApuWBJHK1qwxAoKWJJGK1KwxAoKWhJGK1KwbvNxG8j9mviVZbrK9sRAKcuB18YoU1aEYIkVVLYkiVbvYIkVNLIkiFbvYP3IMRDCRmvKYP1YarGC0NF6PiYL1q2/sAU73FPgNfScJVi39lZiBWV8ei1F3GeF2mFFPjvDjLZgr8nWwbK3gkCWwfZZLYNlbwUBLQPts1oFy94KAlsG2Wd132FFOyMDcV+rLYJlbwUDWAbYZ3WfsN5xCwN4zbUM1uXpSqxgyH3W8zFosG4dBYG4tk7RCnkknH262rbt995/Bua2BH0N1gqWo2CBaAkXPS0Bj4Y1guUoWJBwEdnWOFqhjoRRx9AITFv0EO01WTpYjoIVmbaY/WgYasLiGOFiViWDZbpqTLiYbcrqPmFFOyOPyH6LWV6rpYLlncHOTFv01mLKqjph+fhNe8JF8K+h6R6s7j+uyP8TLgJ6hp2wTFcxCBeZpqy7wTJdDcJiniCe4SYs01VMpi1Gn7LuBMt0NSjhorNnmAnLdDUO4WK0KetqsExXiQgXHTy7T1imq7FZzBN9yroSLNNVYqYtGnp2m7BMV7kIFxGnrO4ffiY24SKSXy2OgxE+5c099ltUeo0/m09YfrZrDqYtejfiTLBMV3xdfH7Rhy5T1u0Jy3Q1L+GidSuqLt3truYgXLR6zR8Nlnuv+Mhinhue1Scsx0FeXBP2W1RrxpFgWbZzmnDNa6m4fL88YZmuOHidmLgo1o4qS3fLdv7JfmsuS6Xl+6dgWbZTjGmLA57FJyzHQe4QLraLx8LiR0LHQY4SrtyWCsfCd8FyHKQJ4eJoe05PWI6D1GIxP5ftwrGw6JHQcZC7TFu5lG6CL/AjJOHiTLDsrwhBuKb1vD1h2V/Ri/1WTmebUuxIaH9FbaatMZVsgx0WwxGuef06enZ0HCQa4crhTVueVSYsx0F6Eq74SjXCkZA0LObzEyxSMW3NFSz3X5GCcKXxPD1hvVu4218RmXDF8a4VR9/UcyRkCsKVg2AxFYv5sQkW0zFt5QiWG0aZinCNdwPprQnLwp0MhKudu81wJIS/2G/FJ1jwjWkrNsGCF4QrJsGCN4QrZrC8QwhvCFeMdwovT1jeIWRGFvP33WmHIyGcZNrqR7DgIuFqT7DgJuFqR7CgEPut+gQLCjJt1SVYUIFw1SFYUJFwlbVcuWnUPVh12YXktSzLH73/DFFcaYwJCxryj9E9ggWNOSZeJ1jQiXCdJ1jQmXAdJ1gQhHB9JlgQjMX8zwQLAjJtvSZYEJhw/Z1gwQCE678ECwaybdvvj4kJFgxm27bfZw2XYMGgtgnD9VvvPwBwzTLhB6kFCwazTBiqL46EMJBl4ljtTFgwgNlD9UWwIDCh+jvBgoCE6jU7LAhGrH5mwoIghOozwYLOhOo4wYJOhOo8wYLGhOre0n09+9uD735PDPiZWN363dPVhAUNCFUZggUVCVVZggUVCFUdggUFCVVd7nSHQsSqPhMW3CRU7QgWXCRUAwVrv4/i3b1akJVQ3XPnPs6vHdbpm0dhRmJV17ubRvf/OBLCsReSb/wMQLDgDaGKRbDgBaGKSbDgG6FKfOOob20gE7Gq724zvgfLO4VMGyqxiv8O4c6RkGmJ1HgEi+kI1bh8+JmpiNUEwfJ1yYzOnmrYr0V+G6yXi3cYlVAN729NssMiJUe/nASLVIQqtyJLdzeQEoFYxVWqEa+C5QZShmJPlf+G0S+OhAzLRDWfYsHyDaS0IlRjKbky+u3s6GZfRS9Clc/ZbzX+aenufixCEavpvGyQHRahCRXVgmWPRSlClcNWcH91KVj2WNQkVPNYLvwq17sbR+2xaEqs+NSe4jssx0LOEqqctsLHwcvBciykBKGa13LxR5o/fZbQsZDifJSGq82pcluDYyGvmKjmsVU4Dt76toarIx1zEitKtONIsC4dC32Eh53j33y269PVx9bcOhJavvPm2vjDo0Ppk9nRI6HlO4eYqLho7f4zX46FczFVsVVathd7l9CxEKGi1Rt1ZyYsy3f+eQH+IVa0WLYXvQ/LlDUXkaLXbVBnd1imrImZqOg5XVVfupOHqYoIfrUa+bxjOCZTFZ98em2X/FTMlWC5J2sCQkUDp1tS9EhoyhqfUBF1uroTLFNWQvZUNHSpIcWX7qas8ZiqGGG6uhssU9bghIpOLrejym0NpqzYhIoRp6sSwTJlDUSoCOBWM6rdOGrKisVCndGnq1LBMmUFZqoikNutqPrRHFNWP0JFtumqZLB+LKcfq2hLqOjlw2u9yEmsys98neEnwcqwo6K2CJ8HLnkkvDxlRXggRiZWBD8KFttzd5+wuE6omE3ppbspqwF7KmacrsJNWPZZ75moaC3auqbGbQ3eMaxArIio5XRV8z4sR8NCHP/oZQt0FAx5JPziaGiiov9r8BFQzTvdHQ0vcvwjuqXDdNXiV3McDWEwW8Cj4BA/8xV1LIWstuCvuRbBunU0jP4AQhbbgddaz+kqxITlw9EwhqXyNzFECtbb8vqsIQz/tTHro4GWE9atv5CjIdRR4LXV7Es8Wx8J7bMgkG2AvVWoHVa0MzIQ9zXZI1j2WRDANsjeKsKEZZ8FHW0D7a2iHAnts6CDbbC9Vdgd1nduKoWQseqqd7Bu7bN2bneAprFaZw7WTrSgsi1BrKIEaydaUMmWJFaRglWE4yHkfk1ECtbtKSvjEwRXbQdfC6NMV9GCtRMtKGBLGKuIwdqJFtywJY1V1GDtRAsu2BLHKnKwdqIFJ2zJYxU9WDvRggO2CWI1QrB2ogVvbJPEapRg7UQLJo/VSMHaiRZMHKvRgrUTLXjMGavd8hjTs9Td7pG/SgMqX9vraI/waBNW0Ulr56M8jGKbPFYjT1iHJq3CozN0U/g6Xh+DGj1YRaO1Ey4iqXDtro+BjXokPPUEOCIyIrHKGaydaJGKWOU9ElY7Hu4cEWmp0vW5PpLIFqxD0drZaxFNpWtyfSSSMVhVorUzbVFDxetwfSSTZYd16Yk6GyD3bFGaWJ2TdcL6zrRFOEJ1TdYJ6zvTFqGI1XUzTFhVJ62d3RYBrq11hmdhpmB9ES6aEqpyZgxW1WjtTFw0un7W2R7pWYN1OFo74eKMRtfL+pjQzMFqMm3tTFxzaHSNrI+JCVajaevPB9tX2KTU8JpYH5MTrAvR2gkXja+B1SMuWK8IF28JVT8mrM7HxD+fBEfFITR+nk1ULwhWkGnri3jF0uk5FasfCNYxwjUZoYpJsCpFq+S3O5i62uj8fJmqDhCsgcK1E6+yAjw3QnWCYA0ari8CNuxzIFQXCFaHcAV74aQX7LEWqhsEK2G4Zg9Y0MdUqAoQrCDhavUVzNkiNsBjJlQFCdak4RotZAM+JkJVgWAFDlekH76oHbREf0+hqkiwBglXpBd1NoViLFQNCNag8doJWPdpUaQaE6wE4dqJV9MjrVB1IlgJ4zV7xCrt20QqAMGaIFzZA1b5DQGhCkSwJo3XiCFreOuFSAUlWONoEq9eUQtwH5hIDUCwxtU1YAkI1IAEKw8Be0+gEhCsvGYPmEAlJFhzyRoxcZqEYDFSyIRpcoJFlKiJER/9BzEJBzWsUBWtAAAAAElFTkSuQmCC'

// Icon edge as a fraction of the foreground frame's shorter side (matches the
// old play_icon variant's proportion, applied to the painted video frame -- not the
// full canvas -- so the icon looks the same size relative to the video).
const OG_ICON_SCALE = 0.26

// Fixed 1.91:1 large-card canvas (FB/LinkedIn 1200x630, ~X's 2:1). Uniform size
// renders full-width on every receiver and avoids their center-crop that mangles
// 1:1 / 9:16 sources.
const OG_CANVAS_WIDTH = 1200
const OG_CANVAS_HEIGHT = 630

// Letterbox bar color for ratios that don't fill 1.91:1 (1:1, 9:16). Black to
// match the /share page shell so the bars read as intentional in the unfurl.
const OG_BAR_COLOR = 'black'

// Cap the composite so a wedged ffmpeg can't hang finalizeRender (mirrors the
// play-icon timeout). One frame decode + downscale + overlay is ~150-350ms, so
// 15s is generous headroom; on timeout the caller fails open and skips the variant.
const OG_FFMPEG_TIMEOUT_MS = 15_000

/**
 * Render the 1200x630 og link-preview variant: extract the opening frame from the
 * hi-res source video (downscaled to fit -> crisp at every ratio), letterbox onto
 * the canvas, center-overlay the play icon at ~26% of the foreground shorter side.
 * Returns the composited JPEG's local path; the caller owns upload + fail-open.
 * `aspectWidth`/`aspectHeight` supply only the source aspect ratio (the fit is
 * deterministic from it), so the caller passes the already-probed base-thumbnail
 * dims to avoid a second ffprobe.
 */
export async function burnOgCanvasThumbnail(
  sourceVideoPath: string,
  tmpDir: string,
  aspectWidth: number,
  aspectHeight: number,
): Promise<string> {
  const iconPath = path.join(tmpDir, 'og_play_icon.png')
  await fs.promises.writeFile(iconPath, Buffer.from(OG_ICON_PNG_BASE64, 'base64'))

  // Largest size that fits inside the canvas while preserving aspect ratio.
  const fitScale = Math.min(OG_CANVAS_WIDTH / aspectWidth, OG_CANVAS_HEIGHT / aspectHeight)
  const fgWidth = Math.round(aspectWidth * fitScale)
  const fgHeight = Math.round(aspectHeight * fitScale)
  const iconEdge = Math.round(Math.min(fgWidth, fgHeight) * OG_ICON_SCALE)

  const outputPath = path.join(tmpDir, 'final_video.mp4.og.jpg')

  await new Promise<void>((resolve, reject) => {
    execFile(
      'ffmpeg',
      [
        '-ss',
        '0',
        '-i',
        sourceVideoPath,
        '-i',
        iconPath,
        '-frames:v',
        '1',
        '-filter_complex',
        // Final crop pins the output to exactly OG_CANVAS_WIDTH x OG_CANVAS_HEIGHT:
        // the mjpeg encoder otherwise emits a frame 1px taller than the padded
        // canvas, which would mismatch the og:image:height=630 we advertise.
        `[0:v]scale=${fgWidth}:${fgHeight},` +
          `pad=${OG_CANVAS_WIDTH}:${OG_CANVAS_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=${OG_BAR_COLOR}[bg];` +
          `[1:v]scale=${iconEdge}:${iconEdge}[ic];` +
          `[bg][ic]overlay=(W-w)/2:(H-h)/2,crop=${OG_CANVAS_WIDTH}:${OG_CANVAS_HEIGHT}:0:0`,
        '-q:v',
        '2',
        '-y',
        outputPath,
      ],
      { timeout: OG_FFMPEG_TIMEOUT_MS },
      (error) => (error ? reject(error) : resolve()),
    )
  })

  return outputPath
}
