import { DrawingUtils, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

const WASM_BASE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'
const MODEL_ASSET_PATH =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task'

export interface Point {
  x: number
  y: number
}

/**
 * Creates a fresh PoseLandmarker instance. detectForVideo() requires strictly increasing
 * timestamps per instance, so the live webcam feed and the reference video feed each need
 * their own instance — never share one landmarker across two unrelated video timelines.
 */
export async function createPoseLandmarker(): Promise<PoseLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE_URL)
  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_ASSET_PATH, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numPoses: 1,
  })
}

const LANDMARK = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const

/** Angle at vertex `b`, between rays b->a and b->c, in degrees. */
function angleAt(b: Point, a: Point, c: Point): number {
  const ab = { x: a.x - b.x, y: a.y - b.y }
  const cb = { x: c.x - b.x, y: c.y - b.y }
  const dot = ab.x * cb.x + ab.y * cb.y
  const mag = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y)
  if (mag === 0) return 0
  const cos = Math.min(1, Math.max(-1, dot / mag))
  return (Math.acos(cos) * 180) / Math.PI
}

export interface JointAngles {
  leftElbow: number
  rightElbow: number
  leftKnee: number
  rightKnee: number
  leftHip: number
  rightHip: number
}

export const JOINT_LABELS: Record<keyof JointAngles, string> = {
  leftElbow: 'Left elbow',
  rightElbow: 'Right elbow',
  leftKnee: 'Left knee',
  rightKnee: 'Right knee',
  leftHip: 'Left hip',
  rightHip: 'Right hip',
}

/** Draws the pose skeleton (connectors + landmark dots) onto a canvas, clearing it first. */
export function drawPoseSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
): void {
  ctx.save()
  ctx.clearRect(0, 0, width, height)
  const drawingUtils = new DrawingUtils(ctx)
  drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
    color: '#8AD7FF',
    lineWidth: 3,
  })
  drawingUtils.drawLandmarks(landmarks, { color: '#EBA846', radius: 4 })
  ctx.restore()
}

/** Computes key joint angles from one pose's 33 landmarks, or null if any needed point is missing. */
export function computeJointAngles(landmarks: Point[]): JointAngles | null {
  const required = Object.values(LANDMARK)
  if (required.some((i) => !landmarks[i])) return null

  const get = (i: number) => landmarks[i]

  return {
    leftElbow: angleAt(get(LANDMARK.leftElbow), get(LANDMARK.leftShoulder), get(LANDMARK.leftWrist)),
    rightElbow: angleAt(get(LANDMARK.rightElbow), get(LANDMARK.rightShoulder), get(LANDMARK.rightWrist)),
    leftKnee: angleAt(get(LANDMARK.leftKnee), get(LANDMARK.leftHip), get(LANDMARK.leftAnkle)),
    rightKnee: angleAt(get(LANDMARK.rightKnee), get(LANDMARK.rightHip), get(LANDMARK.rightAnkle)),
    leftHip: angleAt(get(LANDMARK.leftHip), get(LANDMARK.leftShoulder), get(LANDMARK.leftKnee)),
    rightHip: angleAt(get(LANDMARK.rightHip), get(LANDMARK.rightShoulder), get(LANDMARK.rightKnee)),
  }
}

/** Per-joint angle samples collected over a video/session — raw angles, not deltas. */
export type JointSamples = Record<keyof JointAngles, number[]>

export function createEmptyJointSamples(): JointSamples {
  return {
    leftElbow: [],
    rightElbow: [],
    leftKnee: [],
    rightKnee: [],
    leftHip: [],
    rightHip: [],
  }
}

/** Averages each joint's collected samples; a joint with no samples is omitted, not zeroed. */
export function averageJointSamples(samples: JointSamples): Partial<Record<keyof JointAngles, number>> {
  const averages: Partial<Record<keyof JointAngles, number>> = {}
  for (const joint of Object.keys(JOINT_LABELS) as (keyof JointAngles)[]) {
    const values = samples[joint]
    if (values.length > 0) {
      averages[joint] = values.reduce((sum, v) => sum + v, 0) / values.length
    }
  }
  return averages
}

/** Average |angle change| per second between consecutive samples — a tempo proxy, in deg/sec. */
function averageAngularVelocity(values: number[], timestampsMs: number[]): number {
  let totalVelocity = 0
  let count = 0
  for (let i = 1; i < values.length; i++) {
    const dtSeconds = (timestampsMs[i] - timestampsMs[i - 1]) / 1000
    if (dtSeconds <= 0) continue
    totalVelocity += Math.abs(values[i] - values[i - 1]) / dtSeconds
    count += 1
  }
  return count > 0 ? totalVelocity / count : 0
}

export interface JointStats {
  averageAngle: number
  averageVelocityDegPerSec: number
}

/** Per-joint angle + tempo, for one full session (a live recording, or one reference video). */
export type SessionStats = Partial<Record<keyof JointAngles, JointStats>>

/** Combines angle samples with their per-frame timestamps into per-joint angle + tempo stats. */
export function summarizeSession(samples: JointSamples, timestampsMs: number[]): SessionStats {
  const stats: SessionStats = {}
  for (const joint of Object.keys(JOINT_LABELS) as (keyof JointAngles)[]) {
    const values = samples[joint]
    if (values.length === 0) continue
    stats[joint] = {
      averageAngle: values.reduce((sum, v) => sum + v, 0) / values.length,
      averageVelocityDegPerSec: averageAngularVelocity(values, timestampsMs),
    }
  }
  return stats
}

/**
 * Loads a video off-DOM (not attached to the page), for one-off analysis — e.g. sampling the
 * reference video's angles once, independent of whatever is visibly playing.
 */
export function loadDetachedVideo(src: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.addEventListener('loadedmetadata', () => resolve(video), { once: true })
    video.addEventListener('error', () => reject(new Error('Failed to load video for analysis')), {
      once: true,
    })
    video.src = src
  })
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked)
      resolve()
    }
    video.addEventListener('seeked', onSeeked)
    video.currentTime = time
  })
}

/**
 * Samples a video at evenly-spaced points across its full duration and summarizes the joint
 * angles + tempo found — a one-time, non-live analysis, so it doesn't need to happen in real
 * time or in sync with anything else. The landmarker's timestamp argument just needs to keep
 * increasing; it doesn't need to match the video's own currentTime. Velocity is derived from
 * the (evenly-spaced, so known) gap between samples — coarser than the live webcam's per-frame
 * timestamps, but enough for an overall tempo comparison.
 */
export async function analyzeVideoAverageAngles(
  video: HTMLVideoElement,
  landmarker: PoseLandmarker,
  sampleCount = 15,
): Promise<SessionStats> {
  const samples = createEmptyJointSamples()
  const timestampsMs: number[] = []
  const sampleIntervalMs = (video.duration * 1000) / sampleCount

  for (let i = 0; i < sampleCount; i++) {
    const time = (video.duration * (i + 0.5)) / sampleCount
    await seekTo(video, time)

    const landmarks = landmarker.detectForVideo(video, performance.now()).landmarks[0]
    const angles = landmarks ? computeJointAngles(landmarks) : null
    if (angles) {
      for (const joint of Object.keys(angles) as (keyof JointAngles)[]) {
        samples[joint].push(angles[joint])
      }
      timestampsMs.push(i * sampleIntervalMs)
    }
  }

  return summarizeSession(samples, timestampsMs)
}

const CORRECT_THRESHOLD_DEG = 25
// Below this, the reference joint is basically static — a ratio comparison there is just noise.
const MIN_REFERENCE_VELOCITY_DEG_PER_SEC = 5
const TOO_FAST_RATIO = 1.4
const TOO_SLOW_RATIO = 0.6

export interface AngleSummary {
  averageDelta: Partial<Record<keyof JointAngles, number>>
  overallCorrect: boolean
  feedback: string
}

function tempoNote(userVelocity: number, referenceVelocity: number): string | null {
  if (referenceVelocity < MIN_REFERENCE_VELOCITY_DEG_PER_SEC) return null
  const ratio = userVelocity / referenceVelocity

  if (ratio > TOO_FAST_RATIO) return 'you moved through it faster than the reference pace'
  if (ratio < TOO_SLOW_RATIO) return 'you moved through it slower than the reference pace'
  return null
}

/** Compares your session's overall angle + tempo per joint against the reference's. */
export function compareSessions(userStats: SessionStats, referenceStats: SessionStats): AngleSummary {
  const averageDelta: Partial<Record<keyof JointAngles, number>> = {}
  const lines: string[] = []
  let offJointCount = 0
  let trackedJointCount = 0

  for (const joint of Object.keys(JOINT_LABELS) as (keyof JointAngles)[]) {
    const user = userStats[joint]
    const reference = referenceStats[joint]
    if (!user || !reference) continue

    trackedJointCount += 1
    const delta = Math.abs(user.averageAngle - reference.averageAngle)
    averageDelta[joint] = delta
    const tempo = tempoNote(user.averageVelocityDegPerSec, reference.averageVelocityDegPerSec)

    if (delta > CORRECT_THRESHOLD_DEG) {
      offJointCount += 1
      lines.push(
        `${JOINT_LABELS[joint]} averaged ${user.averageAngle.toFixed(0)}° for you vs ${reference.averageAngle.toFixed(0)}° for the reference — needs correction${tempo ? `, and ${tempo}` : ''}.`,
      )
    } else {
      lines.push(
        `${JOINT_LABELS[joint]} averaged ${user.averageAngle.toFixed(0)}° for you, close to the reference's ${reference.averageAngle.toFixed(0)}°${tempo ? `, though ${tempo}` : ''}.`,
      )
    }
  }

  const overallCorrect = trackedJointCount > 0 && offJointCount === 0
  const headline =
    trackedJointCount === 0
      ? "Couldn't get a clear enough view of both videos to compare joints."
      : overallCorrect
        ? 'Overall: your form matched the reference well.'
        : 'Overall: your form needs some adjustments.'

  return { averageDelta, overallCorrect, feedback: [headline, ...lines].join('\n') }
}
