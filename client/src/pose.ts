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
 * Samples a video at evenly-spaced points across its full duration and averages the joint
 * angles found — a one-time, non-live analysis, so it doesn't need to happen in real time or
 * in sync with anything else. The landmarker's timestamp argument just needs to keep
 * increasing; it doesn't need to match the video's own currentTime.
 */
export async function analyzeVideoAverageAngles(
  video: HTMLVideoElement,
  landmarker: PoseLandmarker,
  sampleCount = 15,
): Promise<Partial<Record<keyof JointAngles, number>>> {
  const samples = createEmptyJointSamples()

  for (let i = 0; i < sampleCount; i++) {
    const time = (video.duration * (i + 0.5)) / sampleCount
    await seekTo(video, time)

    const landmarks = landmarker.detectForVideo(video, performance.now()).landmarks[0]
    const angles = landmarks ? computeJointAngles(landmarks) : null
    if (angles) {
      for (const joint of Object.keys(angles) as (keyof JointAngles)[]) {
        samples[joint].push(angles[joint])
      }
    }
  }

  return averageJointSamples(samples)
}

const CORRECT_THRESHOLD_DEG = 25

export interface AngleSummary {
  averageDelta: Partial<Record<keyof JointAngles, number>>
  overallCorrect: boolean
  feedback: string
}

/** Compares your session's overall average joint angles against the reference's overall averages. */
export function compareAverageAngles(
  userAverages: Partial<Record<keyof JointAngles, number>>,
  referenceAverages: Partial<Record<keyof JointAngles, number>>,
): AngleSummary {
  const averageDelta: Partial<Record<keyof JointAngles, number>> = {}
  const lines: string[] = []
  let offJointCount = 0
  let trackedJointCount = 0

  for (const joint of Object.keys(JOINT_LABELS) as (keyof JointAngles)[]) {
    const userAvg = userAverages[joint]
    const referenceAvg = referenceAverages[joint]
    if (userAvg === undefined || referenceAvg === undefined) continue

    trackedJointCount += 1
    const delta = Math.abs(userAvg - referenceAvg)
    averageDelta[joint] = delta

    if (delta > CORRECT_THRESHOLD_DEG) {
      offJointCount += 1
      lines.push(
        `${JOINT_LABELS[joint]} averaged ${userAvg.toFixed(0)}° for you vs ${referenceAvg.toFixed(0)}° for the reference — needs correction.`,
      )
    } else {
      lines.push(
        `${JOINT_LABELS[joint]} averaged ${userAvg.toFixed(0)}° for you, close to the reference's ${referenceAvg.toFixed(0)}°.`,
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
