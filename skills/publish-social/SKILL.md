---
name: publish-social
description: Publish or schedule a finished ReelMakeEasy video to the user's social accounts (YouTube, X, Instagram, TikTok, LinkedIn, Facebook) through the OpusClip MCP. Use when the user asks to post, publish, share or schedule a video, or to plan when posts go out, and to check or cancel scheduled posts.
---

# Publish a video to social platforms

ReelMakeEasy makes the video; OpusClip's MCP server posts it. The video goes up to OpusClip once,
then to each account the user picks, now or at a set time. Nothing goes out until the user
approves it: every post, schedule and cancel returns an approval link, and the user confirms it
in the OpusClip app.

## Before you start

- **The OpusClip MCP server must be connected** to your agent, with its `opusclip_*` tools
  available. In Claude it's the OpusClip connector; elsewhere, add OpusClip's MCP server as its
  developer docs describe. If the tools are missing, tell the user and stop.
- **Check the account:** `opusclip_whoami` shows the organization the tools act on. To use
  another one, the user disconnects and reconnects the connector and picks it.
- **The user's social accounts must be connected in OpusClip.** `opusclip_list_social_accounts`
  lists them. If the platform they want isn't there, ask them to connect it in the OpusClip
  app first.
- **Importing the video uses OpusClip credits** (about 1 per minute of video). Run
  `opusclip_get_usage` and tell the user before you submit.

## Ask the user, in one short message

1. Which video (by title, if there are several).
2. Which accounts, from `opusclip_list_social_accounts`.
3. Now or when: a date and time, with their time zone. You send it in UTC.
4. The caption: theirs, or one you write (step 5 below).

Repeat the plan back in one line (video, accounts, time, caption) and wait for a clear yes.

## Steps

**1. Find the video.** ReelMakeEasy must be running (`pnpm reelmakeeasy start`).

```bash
curl -fsS "http://localhost:5017/api/project?q=me&page=1&pageSize=20"   # data[]: id, name, stage
curl -fsS "http://localhost:5017/api/long-take-videos/<projectId>"       # data.videoUrl, data.status
```

Use a project whose `stage` is `FINISHED`. Download its video to a temporary file. OpusClip
can't read `localhost`, so the file goes up in the next step:

```bash
curl -fsS -o /tmp/reelmakeeasy-<projectId>.mp4 "<data.videoUrl>"
```

**2. Upload it to OpusClip.** Call `opusclip_create_upload_link` with `extension: "mp4"`, the
file name, and `sizeMb` rounded up. The returned `upload_url` is a resumable upload, so it takes
two requests, as its `instructions` say: start the upload to get a session URL, then send the
file to that URL. A single `PUT` to `upload_url` doesn't work.

```bash
session=$(curl -fsS -D - -o /dev/null -X POST -H "x-goog-resumable: start" -H "Content-Length: 0" \
  "<upload_url>" | awk -F': ' 'tolower($1)=="location"{print $2}' | tr -d '\r')
curl -fsS -X PUT --upload-file /tmp/reelmakeeasy-<projectId>.mp4 "$session"   # 200 when done
```

**3. Import it as one video, unchanged.** Call `opusclip_submit_project` with:

- `videoUrl`: the `upload_id` from step 2;
- `skipCurate: true`: one output, the whole video, not cut into clips;
- `enableCaption: false`: ReelMakeEasy already burned its captions in;
- `aspectRatio`: `portrait` for 9:16 (ReelMakeEasy's default), `landscape` for 16:9, `square` for
  1:1;
- `title`: the video's name.

**4. Wait for it.** Call `opusclip_list_clips` with the returned `projectId` every 30 seconds or
so until a clip is listed. An empty list while the project's `stage` is still in progress means
it isn't ready yet, not that it failed. Keep its `clipId`.

**Then remove what OpusClip added.** Even with `enableCaption: false`, the imported clip gets
OpusClip's caption and emoji tracks, and the emoji show up on screen under ReelMakeEasy's captions.
Turn both off with `opusclip_edit_clip`:

```json
{
  "projectId": "<projectId>",
  "clipId": "<clipId>",
  "ops": [
    { "op": "set_emoji", "enabled": false },
    { "op": "set_captions", "enabled": false }
  ]
}
```

A temporary internal error here is worth one retry a minute later. Calling it with
`dryRun: true` and no `ops` lists the clip's tracks.

**Then render the final version, and check it, before any post or schedule.** A post publishes
the clip's last finished render; one still using the import's settings brings the emoji back on
YouTube even though the edit was saved (this happened: nine Shorts went out with emoji). For
**every** clip, not a sample:

1. The edit starts a re-render: `opusclip_describe_clip` shows `render_pending: true`. Poll it
   (every 15 s or so) until it is `false` again.
2. Trigger the final render with `opusclip_export_clip` (`target: "hd"`). `rendering` means it is
   under way: call it again until it is `ready`.
3. Download the `export_url` and look at frames where an emoji appeared before (contact sheet:
   `ffmpeg -i clip.mp4 -vf "fps=1,scale=240:-1,tile=8x4" -frames:v 1 sheet.png`). Any emoji or
   OpusClip caption left: stop, fix and render again.

Only a clip whose export is checked clean goes to step 6.

**5. Write the caption (optional).** For each account, `opusclip_create_social_copy_job` with
the `projectId`, `clipId` and `postAccountId` (and a tone in `prompt` if the user gave one), then
poll `opusclip_get_social_copy_job` until it finishes. Show the user the copy before using it.

**6. Post or schedule, one call per account.**

- Now: `opusclip_create_post_task` with `projectId`, `clipId`, `postAccountId` and `title`.
- Later: `opusclip_schedule_publish` with the same fields and `publishAt` in ISO 8601 UTC, for
  example `2026-10-20T15:00:00Z`.

Give each returned **approval link** to the user. The post or schedule only happens when they
confirm it in the OpusClip app.

**7. Check.** `opusclip_list_scheduled_posts` with the `projectId` shows each post's status, its
`post_url` once the platform confirms, and `failure_reason` if it failed. A `posted` TikTok post
without a `post_url` yet is posted, with its link still to come.

## Per platform

| Platform                   | `title` is                                        | Useful fields                                                                                                                                             |
| -------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| YouTube                    | the video title (keep it under 100 characters)    | `mediaType: "short"` for a vertical video (Shorts run up to 3 minutes); `privacy`: `public`, `unlisted` or `private`; the post text goes in `description` |
| X                          | the post text (280 characters, hashtags included) |                                                                                                                                                           |
| Instagram                  | the caption                                       | `mediaType: "reel"`                                                                                                                                       |
| TikTok, LinkedIn, Facebook | the post text                                     |                                                                                                                                                           |

None of the tools takes a thumbnail: the platform picks a cover from the video, and the user
can change it afterwards in the platform's own app (for example YouTube Studio).

## Change or cancel a schedule

`opusclip_list_scheduled_posts` (by `projectId`, or by a `startAt`/`endAt` window) gives each
post's `schedule_id`. `opusclip_unschedule_publish` with that id returns an approval link to
cancel it. An immediate post has no `schedule_id` and can't be cancelled this way, and the
`post_task_id` from `opusclip_create_post_task` is not a `schedule_id`. To move a post, cancel it
and schedule it again.

## Rules

- Never post, schedule or cancel without the user's clear yes to that exact plan, even though
  OpusClip asks them again.
- Never invent account ids, project ids or captions the user didn't see.
- Never post a clip whose final export you haven't checked (step 4).
- Delete the temporary video file when you're done.
