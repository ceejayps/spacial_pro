import UIKit
import Capacitor
import AVFoundation
import ARKit
import SceneKit
import WebKit
import simd
import Vision
import ImageIO
import CoreImage

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        return true
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}

@objc(ScannerBridgeViewController)
class ScannerBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        super.capacitorDidLoad()

        // Capacitor v8 ignores registerPluginType when auto plugin registration is enabled.
        // Registering an instance ensures the app-local LiDAR plugin is available.
        bridge?.registerPluginInstance(LidarScannerPlugin())

        if let webView = self.webView {
            LidarScanSessionManager.shared.attachPreview(to: webView)
        }
    }
}

final class LidarScanSessionManager: NSObject, ARSessionDelegate {
    static let shared = LidarScanSessionManager()

    private struct TextureExportContext {
        let camera: ARCamera
        let orientation: UIInterfaceOrientation
        let viewportSize: CGSize
        let mtlFileName: String
        let hasNormalMap: Bool
    }

    private let syncQueue = DispatchQueue(label: "com.lidarpro.scan.session")
    private let visionQueue = DispatchQueue(label: "com.lidarpro.scan.vision")
    private weak var webView: WKWebView?
    private var sceneView: ARSCNView?
    private var meshAnchors: [UUID: ARMeshAnchor] = [:]
    private var meshNodes: [UUID: SCNNode] = [:]
    private var previewing = false
    private var running = false
    private var startedAt: Date?
    private var maxScanDistanceMeters: Float = 5.0
    private var scanDetailLevel: String = "high"
    private var objectDetectionEnabled = false
    private var objectDetectionMinConfidence: Float = 0.55
    private var objectDetectionIntervalMs: Int = 900
    private var objectDetectionInFlight = false
    private var lastObjectDetectionTimeMs: Int64 = 0
    private var latestObjectDetections: [[String: Any]] = []
    private var latestObjectLabels: [String] = []
    private var latestObjectDetectionUpdatedAtMs: Int64 = 0
    private var objectDetectionListener: (([String: Any]) -> Void)?
    private var textRecognitionEnabled = false
    private var textRecognitionIntervalMs: Int = 1100
    private var textRecognitionInFlight = false
    private var lastTextRecognitionTimeMs: Int64 = 0
    private var latestRecognizedText = ""
    private var latestRecognizedTextBlocks: [[String: Any]] = []
    private var latestTextRecognitionUpdatedAtMs: Int64 = 0
    private var textRecognitionListener: (([String: Any]) -> Void)?

    func attachPreview(to webView: WKWebView) {
        if Thread.isMainThread {
            attachPreviewOnMainThread(to: webView)
        } else {
            DispatchQueue.main.async {
                self.attachPreviewOnMainThread(to: webView)
            }
        }
    }

    func startPreview() throws -> [String: Any] {
        guard ARWorldTrackingConfiguration.isSupported else {
            throw NSError(domain: "LidarScanner", code: 1, userInfo: [NSLocalizedDescriptionKey: "ARKit world tracking is not supported on this device."])
        }

        try runPreviewSession(resetTracking: false)

        return syncQueue.sync {
            previewing = true
            running = false
            startedAt = nil
            return buildStatusLocked()
        }
    }

    func stopPreview() -> [String: Any] {
        if Thread.isMainThread {
            sceneView?.session.pause()
        } else {
            DispatchQueue.main.sync {
                self.sceneView?.session.pause()
            }
        }

        let status = syncQueue.sync {
            previewing = false
            running = false
            startedAt = nil
            meshAnchors.removeAll()
            objectDetectionEnabled = false
            objectDetectionInFlight = false
            latestObjectDetections.removeAll()
            latestObjectLabels.removeAll()
            textRecognitionEnabled = false
            textRecognitionInFlight = false
            latestRecognizedText = ""
            latestRecognizedTextBlocks.removeAll()
            clearMeshNodesOnMainThread()
            return buildStatusLocked()
        }

        return status
    }

    func start(
        maxDistanceMeters: Float,
        detailLevel: String
    ) throws {
        guard ARWorldTrackingConfiguration.isSupported else {
            throw NSError(domain: "LidarScanner", code: 1, userInfo: [NSLocalizedDescriptionKey: "ARKit world tracking is not supported on this device."])
        }

        guard #available(iOS 13.4, *) else {
            throw NSError(domain: "LidarScanner", code: 2, userInfo: [NSLocalizedDescriptionKey: "LiDAR mesh capture requires iOS 13.4 or later."])
        }

        syncQueue.sync {
            meshAnchors.removeAll()
            clearMeshNodesOnMainThread()
            maxScanDistanceMeters = sanitizeScanDistance(maxDistanceMeters)
            scanDetailLevel = sanitizeDetailLevel(detailLevel)
        }

        try runScanSession(resetTracking: true)

        syncQueue.sync {
            previewing = true
            running = true
            startedAt = Date()
        }
    }

    func stop() -> [String: Any] {
        do {
            try runPreviewSession(resetTracking: false)
        } catch {
            // Keep status flow resilient even if preview fallback fails.
        }

        let status = syncQueue.sync {
            previewing = true
            running = false
            startedAt = nil
            clearMeshNodesOnMainThread()
            return buildStatusLocked()
        }
        return status
    }

    func status() -> [String: Any] {
        return syncQueue.sync {
            buildStatusLocked()
        }
    }

    func setObjectDetectionListener(_ listener: (([String: Any]) -> Void)?) {
        syncQueue.async {
            self.objectDetectionListener = listener
        }
    }

    func setTextRecognitionListener(_ listener: (([String: Any]) -> Void)?) {
        syncQueue.async {
            self.textRecognitionListener = listener
        }
    }

    func startObjectDetection(minConfidence: Float, intervalMs: Int) -> [String: Any] {
        return syncQueue.sync {
            objectDetectionEnabled = true
            objectDetectionMinConfidence = sanitizeObjectDetectionConfidence(minConfidence)
            objectDetectionIntervalMs = sanitizeObjectDetectionInterval(intervalMs)
            objectDetectionInFlight = false
            lastObjectDetectionTimeMs = 0
            return buildObjectDetectionStatusLocked()
        }
    }

    func stopObjectDetection() -> [String: Any] {
        return syncQueue.sync {
            objectDetectionEnabled = false
            objectDetectionInFlight = false
            return buildObjectDetectionStatusLocked()
        }
    }

    func objectDetectionStatus() -> [String: Any] {
        return syncQueue.sync {
            buildObjectDetectionStatusLocked()
        }
    }

    func startTextRecognition(intervalMs: Int) -> [String: Any] {
        return syncQueue.sync {
            textRecognitionEnabled = true
            textRecognitionIntervalMs = sanitizeTextRecognitionInterval(intervalMs)
            textRecognitionInFlight = false
            lastTextRecognitionTimeMs = 0
            latestTextRecognitionUpdatedAtMs = Int64(Date().timeIntervalSince1970 * 1000.0)
            return buildTextRecognitionStatusLocked()
        }
    }

    func stopTextRecognition() -> [String: Any] {
        return syncQueue.sync {
            textRecognitionEnabled = false
            textRecognitionInFlight = false
            latestRecognizedText = ""
            latestRecognizedTextBlocks = []
            latestTextRecognitionUpdatedAtMs = Int64(Date().timeIntervalSince1970 * 1000.0)
            return buildTextRecognitionStatusLocked()
        }
    }

    func textRecognitionStatus() -> [String: Any] {
        return syncQueue.sync {
            buildTextRecognitionStatusLocked()
        }
    }

    func exportOBJ() throws -> [String: Any] {
        let exportSnapshot = syncQueue.sync {
            return (
                anchors: Array(meshAnchors.values),
                aiDetections: latestObjectDetections
            )
        }
        let anchors = exportSnapshot.anchors

        if anchors.isEmpty {
            throw NSError(domain: "LidarScanner", code: 3, userInfo: [NSLocalizedDescriptionKey: "No mesh data captured yet. Start a scan first."])
        }

        let modelsDirectory = try modelsDirectoryURL()
        let fileBaseName = "scan-\(Int(Date().timeIntervalSince1970))"
        let textureContext = buildTextureExportContext(
            baseName: fileBaseName,
            directoryURL: modelsDirectory
        )
        var lines: [String] = ["# LiDAR Pro OBJ export"]
        if let textureContext = textureContext {
            lines.append("mtllib \(textureContext.mtlFileName)")
        }

        var vertexLines: [String] = []
        var uvLines: [String] = []
        var faceLines: [String] = []
        var globalVertexOffset = 1
        var totalVertices = 0
        var totalFaces = 0

        for anchor in anchors {
            let geometry = anchor.geometry

            for vertexIndex in 0..<geometry.vertices.count {
                let vertex = vertex(at: vertexIndex, source: geometry.vertices)
                let world = anchor.transform * SIMD4<Float>(vertex.x, vertex.y, vertex.z, 1.0)
                let worldPosition = SIMD3<Float>(world.x, world.y, world.z)
                vertexLines.append("v \(worldPosition.x) \(worldPosition.y) \(worldPosition.z)")

                if let textureContext = textureContext {
                    let projected = textureContext.camera.projectPoint(
                        worldPosition,
                        orientation: textureContext.orientation,
                        viewportSize: textureContext.viewportSize
                    )

                    let viewportWidth = max(1.0, Double(textureContext.viewportSize.width))
                    let viewportHeight = max(1.0, Double(textureContext.viewportSize.height))
                    let u = clampUnit(Double(projected.x) / viewportWidth)
                    let v = clampUnit(1.0 - (Double(projected.y) / viewportHeight))
                    uvLines.append("vt \(u) \(v)")
                }
            }

            totalVertices += geometry.vertices.count

            let faces = geometry.faces
            for faceIndex in 0..<faces.count {
                let indices = faceIndices(for: faceIndex, faces: faces)

                if indices.count >= 3 {
                    let a = Int(indices[0]) + globalVertexOffset
                    let b = Int(indices[1]) + globalVertexOffset
                    let c = Int(indices[2]) + globalVertexOffset
                    if textureContext != nil {
                        faceLines.append("f \(a)/\(a) \(b)/\(b) \(c)/\(c)")
                    } else {
                        faceLines.append("f \(a) \(b) \(c)")
                    }
                    totalFaces += 1
                }
            }

            globalVertexOffset += geometry.vertices.count
        }

        lines.append(contentsOf: vertexLines)
        if textureContext != nil {
            lines.append(contentsOf: uvLines)
            lines.append("usemtl scanMaterial")
        }
        lines.append(contentsOf: faceLines)

        let contents = lines.joined(separator: "\n")
        let fileName = "\(fileBaseName).obj"
        let fileURL = modelsDirectory.appendingPathComponent(fileName)

        try contents.write(to: fileURL, atomically: true, encoding: .utf8)

        return [
            "format": "obj",
            "fileUrl": fileURL.absoluteString,
            "filePath": fileURL.path,
            "vertexCount": totalVertices,
            "faceCount": totalFaces,
            "textured": textureContext != nil,
            "normalMap": textureContext?.hasNormalMap ?? false,
            "aiDetections": exportSnapshot.aiDetections
        ]
    }

    func listSavedModels() -> [[String: Any]] {
        do {
            let modelsDirectory = try modelsDirectoryURL()
            let fileManager = FileManager.default
            let urls = try fileManager.contentsOfDirectory(
                at: modelsDirectory,
                includingPropertiesForKeys: [.creationDateKey, .contentModificationDateKey, .fileSizeKey],
                options: [.skipsHiddenFiles]
            )

            let modelUrls = urls
                .filter { isModelFile(url: $0) }
                .sorted { $0.lastPathComponent > $1.lastPathComponent }

            var results: [[String: Any]] = []
            results.reserveCapacity(modelUrls.count)

            for modelURL in modelUrls {
                let values = try modelURL.resourceValues(
                    forKeys: [.creationDateKey, .contentModificationDateKey, .fileSizeKey]
                )

                let createdAt = values.creationDate ?? values.contentModificationDate ?? Date()
                let sizeBytes = values.fileSize ?? 0
                let format = modelURL.pathExtension.lowercased()
                let title = modelURL.deletingPathExtension().lastPathComponent
                    .replacingOccurrences(of: "-", with: " ")
                    .capitalized

                results.append([
                    "id": "device-\(modelURL.deletingPathExtension().lastPathComponent)",
                    "title": title,
                    "capturedAtMs": Int64(createdAt.timeIntervalSince1970 * 1000.0),
                    "format": format.isEmpty ? "obj" : format,
                    "fileUrl": modelURL.absoluteString,
                    "filePath": modelURL.path,
                    "fileSizeBytes": sizeBytes
                ])
            }

            return results
        } catch {
            return []
        }
    }

    func deleteSavedModel(filePath: String) throws -> [String: Any] {
        let trimmedPath = filePath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedPath.isEmpty else {
            throw NSError(
                domain: "LidarScanner",
                code: 9,
                userInfo: [NSLocalizedDescriptionKey: "Model file path is required."]
            )
        }

        let modelsDirectory = try modelsDirectoryURL()
        let targetName = URL(fileURLWithPath: trimmedPath).lastPathComponent
        let baseName = URL(fileURLWithPath: targetName).deletingPathExtension().lastPathComponent

        guard !baseName.isEmpty else {
            throw NSError(
                domain: "LidarScanner",
                code: 10,
                userInfo: [NSLocalizedDescriptionKey: "Unable to resolve model file name."]
            )
        }

        let fileManager = FileManager.default
        let relatedFileNames = [
            "\(baseName).obj",
            "\(baseName).gltf",
            "\(baseName).glb",
            "\(baseName).mtl",
            "\(baseName)-albedo.jpg",
            "\(baseName)-normal.jpg"
        ]

        var deletedAny = false

        for fileName in relatedFileNames {
            let candidateURL = modelsDirectory.appendingPathComponent(fileName)

            if fileManager.fileExists(atPath: candidateURL.path) {
                try fileManager.removeItem(at: candidateURL)
                deletedAny = true
            }
        }

        return [
            "deleted": deletedAny,
            "filePath": modelsDirectory.appendingPathComponent(targetName).path
        ]
    }

    private func isModelFile(url: URL) -> Bool {
        let ext = url.pathExtension.lowercased()
        return ext == "obj" || ext == "glb" || ext == "gltf"
    }

    private func modelsDirectoryURL() throws -> URL {
        let fileManager = FileManager.default
        guard let documentsURL = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first else {
            throw NSError(
                domain: "LidarScanner",
                code: 8,
                userInfo: [NSLocalizedDescriptionKey: "Unable to access app Documents directory."]
            )
        }

        let modelsURL = documentsURL
            .appendingPathComponent("LiDARPro", isDirectory: true)
            .appendingPathComponent("models", isDirectory: true)

        try fileManager.createDirectory(at: modelsURL, withIntermediateDirectories: true)
        return modelsURL
    }

    private func buildTextureExportContext(
        baseName: String,
        directoryURL: URL
    ) -> TextureExportContext? {
        guard let frame = currentARFrame() else {
            return nil
        }

        let projectionOrientation = currentInterfaceOrientation()
        let textureFileName = "\(baseName)-albedo.jpg"
        let normalFileName = "\(baseName)-normal.jpg"
        let mtlFileName = "\(baseName).mtl"
        let textureURL = directoryURL.appendingPathComponent(textureFileName)
        let normalURL = directoryURL.appendingPathComponent(normalFileName)
        let mtlURL = directoryURL.appendingPathComponent(mtlFileName)

        guard let textureSize = writeJPEGTexture(
            pixelBuffer: frame.capturedImage,
            to: textureURL,
            orientation: projectionOrientation
        ) else {
            return nil
        }

        let hasNormalMap = writeApproximateNormalMap(
            pixelBuffer: frame.capturedImage,
            to: normalURL,
            orientation: projectionOrientation
        )

        let mtlContents = """
        newmtl scanMaterial
        Ka 1.000 1.000 1.000
        Kd 1.000 1.000 1.000
        Ks 0.000 0.000 0.000
        d 1.0
        illum 2
        map_Kd \(textureFileName)
        \(hasNormalMap ? "map_Bump \(normalFileName)" : "")
        """

        do {
            try mtlContents.write(to: mtlURL, atomically: true, encoding: .utf8)
        } catch {
            return nil
        }

        let viewportSize = CGSize(
            width: max(1.0, textureSize.width),
            height: max(1.0, textureSize.height)
        )

        return TextureExportContext(
            camera: frame.camera,
            orientation: projectionOrientation,
            viewportSize: viewportSize,
            mtlFileName: mtlFileName,
            hasNormalMap: hasNormalMap
        )
    }

    private func currentARFrame() -> ARFrame? {
        if Thread.isMainThread {
            return sceneView?.session.currentFrame
        }

        var frame: ARFrame?
        DispatchQueue.main.sync {
            frame = self.sceneView?.session.currentFrame
        }
        return frame
    }

    private func writeJPEGTexture(
        pixelBuffer: CVPixelBuffer,
        to url: URL,
        orientation: UIInterfaceOrientation
    ) -> CGSize? {
        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        let orientedImage = ciImage.oriented(forExifOrientation: Int32(exifOrientation(for: orientation).rawValue))
        let context = CIContext(options: nil)

        guard let cgImage = context.createCGImage(orientedImage, from: orientedImage.extent) else {
            return nil
        }

        let image = UIImage(cgImage: cgImage)

        guard let jpegData = image.jpegData(compressionQuality: 0.88) else {
            return nil
        }

        do {
            try jpegData.write(to: url, options: .atomic)
            return CGSize(width: CGFloat(cgImage.width), height: CGFloat(cgImage.height))
        } catch {
            return nil
        }
    }

    private func writeApproximateNormalMap(
        pixelBuffer: CVPixelBuffer,
        to url: URL,
        orientation: UIInterfaceOrientation
    ) -> Bool {
        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        let orientedImage = ciImage.oriented(forExifOrientation: Int32(exifOrientation(for: orientation).rawValue))
        let context = CIContext(options: nil)

        guard let cgImage = context.createCGImage(orientedImage, from: orientedImage.extent) else {
            return false
        }

        guard let normalMapImage = buildNormalMapImage(from: cgImage) else {
            return false
        }

        let image = UIImage(cgImage: normalMapImage)
        guard let jpegData = image.jpegData(compressionQuality: 0.92) else {
            return false
        }

        do {
            try jpegData.write(to: url, options: .atomic)
            return true
        } catch {
            return false
        }
    }

    private func buildNormalMapImage(from sourceImage: CGImage) -> CGImage? {
        let width = sourceImage.width
        let height = sourceImage.height

        guard width > 1, height > 1 else {
            return nil
        }

        let bytesPerPixel = 4
        let bytesPerRow = width * bytesPerPixel
        let pixelCount = width * height
        let bitmapInfo = CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue
        let colorSpace = CGColorSpaceCreateDeviceRGB()

        var sourcePixels = [UInt8](repeating: 0, count: pixelCount * bytesPerPixel)
        let didReadSource = sourcePixels.withUnsafeMutableBytes { rawBuffer -> Bool in
            guard let baseAddress = rawBuffer.baseAddress else {
                return false
            }

            guard let context = CGContext(
                data: baseAddress,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: bytesPerRow,
                space: colorSpace,
                bitmapInfo: bitmapInfo
            ) else {
                return false
            }

            context.draw(sourceImage, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }

        guard didReadSource else {
            return nil
        }

        var normalPixels = [UInt8](repeating: 0, count: pixelCount * bytesPerPixel)
        let strength: Float = 4.5

        func luma(_ x: Int, _ y: Int) -> Float {
            let clampedX = min(max(0, x), width - 1)
            let clampedY = min(max(0, y), height - 1)
            let offset = (clampedY * bytesPerRow) + (clampedX * bytesPerPixel)

            let r = Float(sourcePixels[offset]) / 255.0
            let g = Float(sourcePixels[offset + 1]) / 255.0
            let b = Float(sourcePixels[offset + 2]) / 255.0

            return 0.299 * r + 0.587 * g + 0.114 * b
        }

        for y in 0..<height {
            for x in 0..<width {
                let left = luma(x - 1, y)
                let right = luma(x + 1, y)
                let up = luma(x, y - 1)
                let down = luma(x, y + 1)

                let gx = (right - left) * strength
                let gy = (down - up) * strength

                var nx = -gx
                var ny = -gy
                var nz: Float = 1.0

                let length = sqrt((nx * nx) + (ny * ny) + (nz * nz))
                if length > 0.0001 {
                    nx /= length
                    ny /= length
                    nz /= length
                }

                let offset = (y * bytesPerRow) + (x * bytesPerPixel)
                normalPixels[offset] = encodeNormalComponent(nx)
                normalPixels[offset + 1] = encodeNormalComponent(ny)
                normalPixels[offset + 2] = encodeNormalComponent(nz)
                normalPixels[offset + 3] = 255
            }
        }

        guard let provider = CGDataProvider(data: Data(normalPixels) as CFData) else {
            return nil
        }

        return CGImage(
            width: width,
            height: height,
            bitsPerComponent: 8,
            bitsPerPixel: 32,
            bytesPerRow: bytesPerRow,
            space: colorSpace,
            bitmapInfo: CGBitmapInfo(rawValue: bitmapInfo),
            provider: provider,
            decode: nil,
            shouldInterpolate: false,
            intent: .defaultIntent
        )
    }

    private func encodeNormalComponent(_ value: Float) -> UInt8 {
        let mapped = (value * 0.5) + 0.5
        let scaled = Int((mapped * 255.0).rounded())
        return UInt8(min(max(0, scaled), 255))
    }

    private func currentInterfaceOrientation() -> UIInterfaceOrientation {
        if Thread.isMainThread {
            return currentInterfaceOrientationOnMainThread()
        }

        var orientation: UIInterfaceOrientation = .portrait
        DispatchQueue.main.sync {
            orientation = self.currentInterfaceOrientationOnMainThread()
        }
        return orientation
    }

    private func currentInterfaceOrientationOnMainThread() -> UIInterfaceOrientation {
        if let sceneOrientation = sceneView?.window?.windowScene?.interfaceOrientation,
           sceneOrientation != .unknown {
            return sceneOrientation
        }

        if #available(iOS 13.0, *) {
            let windowScene = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .first { $0.activationState == .foregroundActive }
                ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first

            if let windowScene = windowScene, windowScene.interfaceOrientation != .unknown {
                return windowScene.interfaceOrientation
            }
        }

        return interfaceOrientation(from: UIDevice.current.orientation)
    }

    private func interfaceOrientation(from deviceOrientation: UIDeviceOrientation) -> UIInterfaceOrientation {
        switch deviceOrientation {
        case .portrait:
            return .portrait
        case .portraitUpsideDown:
            return .portraitUpsideDown
        case .landscapeLeft:
            return .landscapeRight
        case .landscapeRight:
            return .landscapeLeft
        default:
            return .portrait
        }
    }

    private func exifOrientation(for orientation: UIInterfaceOrientation) -> CGImagePropertyOrientation {
        switch orientation {
        case .portrait:
            return .right
        case .portraitUpsideDown:
            return .left
        case .landscapeLeft:
            return .up
        case .landscapeRight:
            return .down
        default:
            return .right
        }
    }

    func session(_ session: ARSession, didAdd anchors: [ARAnchor]) {
        updateAnchors(anchors)
    }

    func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) {
        updateAnchors(anchors)
    }

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        processObjectDetection(frame: frame)
        processTextRecognition(frame: frame)
    }

    func session(_ session: ARSession, didRemove anchors: [ARAnchor]) {
        let removedIDs = anchors.compactMap { ($0 as? ARMeshAnchor)?.identifier }

        guard !removedIDs.isEmpty else {
            return
        }

        syncQueue.async {
            for id in removedIDs {
                self.meshAnchors.removeValue(forKey: id)
            }
        }

        removeMeshNodesOnMainThread(ids: removedIDs)
    }

    private func attachPreviewOnMainThread(to webView: WKWebView) {
        self.webView = webView

        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear

        let activeSceneView: ARSCNView
        if let existing = self.sceneView {
            activeSceneView = existing
            activeSceneView.frame = webView.bounds
        } else {
            let created = ARSCNView(frame: webView.bounds)
            created.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            created.backgroundColor = .clear
            created.automaticallyUpdatesLighting = true
            created.isUserInteractionEnabled = false
            created.scene = SCNScene()
            created.session.delegate = self
            self.sceneView = created
            activeSceneView = created
        }

        if activeSceneView.superview !== webView.scrollView {
            webView.scrollView.insertSubview(activeSceneView, at: 0)
        } else {
            webView.scrollView.sendSubviewToBack(activeSceneView)
        }
    }

    private func ensureSceneView() throws -> ARSCNView {
        if let sceneView = self.sceneView {
            return sceneView
        }

        if Thread.isMainThread, let webView = self.webView {
            attachPreviewOnMainThread(to: webView)
            if let sceneView = self.sceneView {
                return sceneView
            }
        }

        throw NSError(
            domain: "LidarScanner",
            code: 4,
            userInfo: [NSLocalizedDescriptionKey: "AR preview view not ready. Open the scan page first."]
        )
    }

    private func runPreviewSession(resetTracking: Bool) throws {
        let sceneView = try ensureSceneView()

        let config = ARWorldTrackingConfiguration()
        config.planeDetection = [.horizontal, .vertical]

        if #available(iOS 13.4, *), ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
            config.frameSemantics.insert(.sceneDepth)
        }

        if Thread.isMainThread {
            sceneView.session.run(config, options: resetTracking ? [.resetTracking, .removeExistingAnchors] : [])
        } else {
            DispatchQueue.main.sync {
                sceneView.session.run(config, options: resetTracking ? [.resetTracking, .removeExistingAnchors] : [])
            }
        }
    }

    private func runScanSession(resetTracking: Bool) throws {
        let sceneView = try ensureSceneView()
        let detailLevel = syncQueue.sync { scanDetailLevel }

        let config = ARWorldTrackingConfiguration()
        config.planeDetection = [.horizontal, .vertical]

        if detailLevel == "high" {
            if #available(iOS 14.0, *), ARWorldTrackingConfiguration.supportsFrameSemantics(.smoothedSceneDepth) {
                config.frameSemantics.insert(.smoothedSceneDepth)
            } else if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
                config.frameSemantics.insert(.sceneDepth)
            }
        } else if detailLevel == "balanced" {
            if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
                config.frameSemantics.insert(.sceneDepth)
            }
        }

        if detailLevel == "high", ARWorldTrackingConfiguration.supportsSceneReconstruction(.meshWithClassification) {
            config.sceneReconstruction = .meshWithClassification
        } else if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
            config.sceneReconstruction = .mesh
        }

        if Thread.isMainThread {
            sceneView.session.run(config, options: resetTracking ? [.resetTracking, .removeExistingAnchors] : [])
        } else {
            DispatchQueue.main.sync {
                sceneView.session.run(config, options: resetTracking ? [.resetTracking, .removeExistingAnchors] : [])
            }
        }
    }

    private func updateAnchors(_ anchors: [ARAnchor]) {
        let meshUpdates = anchors.compactMap { $0 as? ARMeshAnchor }

        guard !meshUpdates.isEmpty else {
            return
        }

        let (isRunning, maxDistance) = syncQueue.sync { (running, maxScanDistanceMeters) }
        let cameraTransform = sceneView?.session.currentFrame?.camera.transform

        var acceptedAnchors: [ARMeshAnchor] = []
        var rejectedIDs: [UUID] = []

        if isRunning, let camera = cameraTransform {
            for anchor in meshUpdates {
                if distance(from: anchor.transform, to: camera) <= maxDistance {
                    acceptedAnchors.append(anchor)
                } else {
                    rejectedIDs.append(anchor.identifier)
                }
            }
        } else {
            acceptedAnchors = meshUpdates
        }

        syncQueue.async {
            for anchor in acceptedAnchors {
                self.meshAnchors[anchor.identifier] = anchor
            }

            for id in rejectedIDs {
                self.meshAnchors.removeValue(forKey: id)
            }
        }

        upsertMeshNodesOnMainThread(acceptedAnchors)
        removeMeshNodesOnMainThread(ids: rejectedIDs)
    }

    private func upsertMeshNodesOnMainThread(_ anchors: [ARMeshAnchor]) {
        guard !anchors.isEmpty else {
            return
        }

        DispatchQueue.main.async {
            guard let sceneView = self.sceneView else {
                return
            }

            for anchor in anchors {
                let meshNode = self.meshNodes[anchor.identifier] ?? SCNNode()
                meshNode.simdTransform = anchor.transform
                meshNode.geometry = self.buildSceneGeometry(from: anchor.geometry)

                if self.meshNodes[anchor.identifier] == nil {
                    sceneView.scene.rootNode.addChildNode(meshNode)
                    self.meshNodes[anchor.identifier] = meshNode
                }
            }
        }
    }

    private func removeMeshNodesOnMainThread(ids: [UUID]) {
        guard !ids.isEmpty else {
            return
        }

        DispatchQueue.main.async {
            for id in ids {
                self.meshNodes[id]?.removeFromParentNode()
                self.meshNodes.removeValue(forKey: id)
            }
        }
    }

    private func clearMeshNodesOnMainThread() {
        DispatchQueue.main.async {
            for node in self.meshNodes.values {
                node.removeFromParentNode()
            }
            self.meshNodes.removeAll()
        }
    }

    private func buildSceneGeometry(from meshGeometry: ARMeshGeometry) -> SCNGeometry {
        let vertices = meshGeometry.vertices
        let vertexSource = SCNGeometrySource(
            buffer: vertices.buffer,
            vertexFormat: .float3,
            semantic: .vertex,
            vertexCount: vertices.count,
            dataOffset: vertices.offset,
            dataStride: vertices.stride
        )

        let faces = meshGeometry.faces
        let bytesPerIndex = faces.bytesPerIndex
        let primitiveCount = faces.count
        let indexDataLength = primitiveCount * 3 * bytesPerIndex
        let indexData = Data(bytes: faces.buffer.contents(), count: indexDataLength)
        let element = SCNGeometryElement(
            data: indexData,
            primitiveType: .triangles,
            primitiveCount: primitiveCount,
            bytesPerIndex: bytesPerIndex
        )

        let geometry = SCNGeometry(sources: [vertexSource], elements: [element])
        let material = SCNMaterial()
        material.diffuse.contents = UIColor.systemCyan.withAlphaComponent(0.9)
        material.emission.contents = UIColor.systemBlue.withAlphaComponent(0.85)
        material.fillMode = .lines
        material.lightingModel = .constant
        material.isDoubleSided = true
        geometry.materials = [material]

        return geometry
    }

    private func processObjectDetection(frame: ARFrame) {
        let orientation = imageOrientationForDevice()
        let pixelBuffer = frame.capturedImage
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000.0)

        let shouldRun: Bool
        let minConfidence: Float

        (shouldRun, minConfidence) = syncQueue.sync {
            guard objectDetectionEnabled else {
                return (false, objectDetectionMinConfidence)
            }

            guard !objectDetectionInFlight else {
                return (false, objectDetectionMinConfidence)
            }

            let elapsed = nowMs - lastObjectDetectionTimeMs
            guard elapsed >= Int64(objectDetectionIntervalMs) else {
                return (false, objectDetectionMinConfidence)
            }

            objectDetectionInFlight = true
            lastObjectDetectionTimeMs = nowMs
            return (true, objectDetectionMinConfidence)
        }

        guard shouldRun else {
            return
        }

        visionQueue.async {
            let detectionResult = self.runVisionDetection(
                pixelBuffer: pixelBuffer,
                orientation: orientation,
                minConfidence: minConfidence
            )

            let payload: [String: Any]
            let listener: (([String: Any]) -> Void)?

            (payload, listener) = self.syncQueue.sync {
                self.objectDetectionInFlight = false

                switch detectionResult {
                case let .success((detections, labels)):
                    self.latestObjectDetections = detections
                    self.latestObjectLabels = labels
                    self.latestObjectDetectionUpdatedAtMs = Int64(Date().timeIntervalSince1970 * 1000.0)
                    return (self.buildObjectDetectionStatusLocked(), self.objectDetectionListener)
                case let .failure(error):
                    return (self.buildObjectDetectionStatusLocked(error: error.localizedDescription), self.objectDetectionListener)
                }
            }

            if let listener = listener {
                DispatchQueue.main.async {
                    listener(payload)
                }
            }
        }
    }

    private func processTextRecognition(frame: ARFrame) {
        let orientation = imageOrientationForDevice()
        let pixelBuffer = frame.capturedImage
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000.0)

        let shouldRun: Bool

        shouldRun = syncQueue.sync {
            guard textRecognitionEnabled else {
                return false
            }

            guard !textRecognitionInFlight else {
                return false
            }

            let elapsed = nowMs - lastTextRecognitionTimeMs
            guard elapsed >= Int64(textRecognitionIntervalMs) else {
                return false
            }

            textRecognitionInFlight = true
            lastTextRecognitionTimeMs = nowMs
            return true
        }

        guard shouldRun else {
            return
        }

        visionQueue.async {
            let recognitionResult = self.runVisionTextRecognition(
                pixelBuffer: pixelBuffer,
                orientation: orientation
            )

            let payload: [String: Any]
            let listener: (([String: Any]) -> Void)?

            (payload, listener) = self.syncQueue.sync {
                self.textRecognitionInFlight = false

                switch recognitionResult {
                case let .success((text, blocks)):
                    self.latestRecognizedText = text
                    self.latestRecognizedTextBlocks = blocks
                    self.latestTextRecognitionUpdatedAtMs = Int64(Date().timeIntervalSince1970 * 1000.0)
                    return (self.buildTextRecognitionStatusLocked(), self.textRecognitionListener)
                case let .failure(error):
                    return (self.buildTextRecognitionStatusLocked(error: error.localizedDescription), self.textRecognitionListener)
                }
            }

            if let listener = listener {
                DispatchQueue.main.async {
                    listener(payload)
                }
            }
        }
    }

    private func runVisionTextRecognition(
        pixelBuffer: CVPixelBuffer,
        orientation: CGImagePropertyOrientation
    ) -> Result<(String, [[String: Any]]), Error> {
        do {
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            request.recognitionLanguages = ["en-US"]

            let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: orientation, options: [:])
            try handler.perform([request])

            let observations = (request.results ?? []).prefix(24)
            var entries: [(text: String, bbox: (x: Double, y: Double, width: Double, height: Double))] = []
            entries.reserveCapacity(observations.count)

            for observation in observations {
                guard let candidate = observation.topCandidates(1).first else {
                    continue
                }

                let value = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !value.isEmpty else {
                    continue
                }

                let bbox = normalizedTopLeftBoundingBox(observation.boundingBox)
                entries.append((text: value, bbox: bbox))
            }

            let sortedEntries = entries.sorted { lhs, rhs in
                let lhsCenterY = lhs.bbox.y + (lhs.bbox.height * 0.5)
                let rhsCenterY = rhs.bbox.y + (rhs.bbox.height * 0.5)
                let lineTolerance = max(lhs.bbox.height, rhs.bbox.height) * 0.65

                if abs(lhsCenterY - rhsCenterY) <= lineTolerance {
                    return lhs.bbox.x < rhs.bbox.x
                }

                return lhsCenterY < rhsCenterY
            }

            var blocks: [[String: Any]] = []
            var textLines: [String] = []
            blocks.reserveCapacity(sortedEntries.count)
            textLines.reserveCapacity(sortedEntries.count)

            for (index, entry) in sortedEntries.enumerated() {
                textLines.append(entry.text)
                blocks.append([
                    "id": "ios-text-\(Int(Date().timeIntervalSince1970 * 1000.0))-\(index)",
                    "text": entry.text,
                    "bbox": [entry.bbox.x, entry.bbox.y, entry.bbox.width, entry.bbox.height],
                    "bboxNormalized": true,
                    "source": "ios-vision-text"
                ])
            }

            return .success((textLines.joined(separator: "\n"), blocks))
        } catch {
            return .failure(error)
        }
    }

    private func runVisionDetection(
        pixelBuffer: CVPixelBuffer,
        orientation: CGImagePropertyOrientation,
        minConfidence: Float
    ) -> Result<([[String: Any]], [String]), Error> {
        do {
            let saliencyRequest = VNGenerateObjectnessBasedSaliencyImageRequest()
            let saliencyHandler = VNImageRequestHandler(
                cvPixelBuffer: pixelBuffer,
                orientation: orientation,
                options: [:]
            )
            try saliencyHandler.perform([saliencyRequest])

            var classifications: [(label: String, confidence: Double)] = []
            do {
                let classifyRequest = VNClassifyImageRequest()
                let classifyHandler = VNImageRequestHandler(
                    cvPixelBuffer: pixelBuffer,
                    orientation: orientation,
                    options: [:]
                )
                try classifyHandler.perform([classifyRequest])
                classifications = (classifyRequest.results ?? [])
                    .filter { $0.confidence >= minConfidence }
                    .prefix(3)
                    .map { (label: $0.identifier, confidence: Double($0.confidence)) }
            } catch {
                classifications = []
            }

            var labels: [String] = []
            var seenLabels = Set<String>()
            for item in classifications {
                let normalized = item.label
                    .trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
                    .lowercased()

                if normalized.isEmpty || seenLabels.contains(normalized) {
                    continue
                }

                seenLabels.insert(normalized)
                labels.append(item.label)
            }

            let salientObjects = saliencyRequest.results?.first?.salientObjects ?? []
            var detections: [[String: Any]] = []
            detections.reserveCapacity(min(6, salientObjects.count))

            for (index, salientObject) in salientObjects.prefix(6).enumerated() {
                let bbox = normalizedTopLeftBoundingBox(salientObject.boundingBox)
                var label = classifications.isEmpty ? "Object" : classifications[min(index, classifications.count - 1)].label
                var labelConfidence = classifications.isEmpty ? 0.45 : classifications[min(index, classifications.count - 1)].confidence

                if let regionalLabel = classifyRegionLabel(
                    pixelBuffer: pixelBuffer,
                    orientation: orientation,
                    bbox: bbox,
                    minConfidence: minConfidence
                ) {
                    label = regionalLabel.label
                    labelConfidence = regionalLabel.confidence
                }

                let score = max(labelConfidence, Double(salientObject.confidence))
                let worldPosition = worldPositionForNormalizedBoundingBox(bbox)

                guard score >= Double(minConfidence) else {
                    continue
                }

                var detection: [String: Any] = [
                    "id": "ios-\(Int(Date().timeIntervalSince1970 * 1000.0))-\(index)",
                    "class": label,
                    "score": score,
                    "bbox": [bbox.x, bbox.y, bbox.width, bbox.height],
                    "bboxNormalized": true,
                    "source": "ios-vision"
                ]

                if let worldPosition = worldPosition {
                    detection["worldPosition"] = worldPosition
                    detection["worldPositionAvailable"] = true
                    if let distanceMeters = distanceMetersForWorldPosition(worldPosition) {
                        detection["distanceMeters"] = distanceMeters
                    }
                } else {
                    detection["worldPositionAvailable"] = false
                }

                detections.append(detection)
            }

            return .success((detections, labels))
        } catch let primaryError {
            // Fallback path for devices/OS builds where saliency can fail (e.g. Espresso plan errors).
            // Keep object detection usable by returning top image classifications with synthetic boxes.
            do {
                let classifyRequest = VNClassifyImageRequest()
                let fallbackHandler = VNImageRequestHandler(
                    cvPixelBuffer: pixelBuffer,
                    orientation: orientation,
                    options: [:]
                )
                try fallbackHandler.perform([classifyRequest])

                let fallbackClassifications = (classifyRequest.results ?? [])
                    .filter { $0.confidence >= minConfidence }
                    .prefix(3)
                    .map { (label: $0.identifier, confidence: Double($0.confidence)) }

                if fallbackClassifications.isEmpty {
                    return .failure(primaryError)
                }

                var fallbackDetections: [[String: Any]] = []
                fallbackDetections.reserveCapacity(fallbackClassifications.count)
                var labels: [String] = []
                labels.reserveCapacity(fallbackClassifications.count)

                for (index, item) in fallbackClassifications.enumerated() {
                    labels.append(item.label)
                    let rowHeight = 0.20
                    let top = min(0.75, 0.10 + (Double(index) * 0.24))
                    let bbox = (x: 0.10, y: top, width: 0.80, height: rowHeight)
                    let worldPosition = worldPositionForNormalizedBoundingBox(bbox)

                    var detection: [String: Any] = [
                        "id": "ios-fallback-\(Int(Date().timeIntervalSince1970 * 1000.0))-\(index)",
                        "class": item.label,
                        "score": max(item.confidence, Double(minConfidence)),
                        "bbox": [bbox.x, bbox.y, bbox.width, bbox.height],
                        "bboxNormalized": true,
                        "source": "ios-vision-fallback"
                    ]

                    if let worldPosition = worldPosition {
                        detection["worldPosition"] = worldPosition
                        detection["worldPositionAvailable"] = true
                        if let distanceMeters = distanceMetersForWorldPosition(worldPosition) {
                            detection["distanceMeters"] = distanceMeters
                        }
                    } else {
                        detection["worldPositionAvailable"] = false
                    }

                    fallbackDetections.append(detection)
                }

                return .success((fallbackDetections, labels))
            } catch {
                // Continue to a geometric fallback that does not require model-based vision plans.
            }

            do {
                let rectanglesRequest = VNDetectRectanglesRequest()
                rectanglesRequest.maximumObservations = 6
                rectanglesRequest.minimumConfidence = min(0.8, max(0.35, minConfidence))
                rectanglesRequest.minimumAspectRatio = 0.2
                rectanglesRequest.quadratureTolerance = 45

                let rectangleHandler = VNImageRequestHandler(
                    cvPixelBuffer: pixelBuffer,
                    orientation: orientation,
                    options: [:]
                )
                try rectangleHandler.perform([rectanglesRequest])

                let rectangles = Array((rectanglesRequest.results ?? []).prefix(6))
                guard !rectangles.isEmpty else {
                    return .failure(primaryError)
                }

                var rectangleDetections: [[String: Any]] = []
                rectangleDetections.reserveCapacity(rectangles.count)
                let labels = ["Object"]

                for (index, rectangle) in rectangles.enumerated() {
                    let bbox = normalizedTopLeftBoundingBox(rectangle.boundingBox)
                    let worldPosition = worldPositionForNormalizedBoundingBox(bbox)

                    var detection: [String: Any] = [
                        "id": "ios-rect-fallback-\(Int(Date().timeIntervalSince1970 * 1000.0))-\(index)",
                        "class": "Object",
                        "score": max(Double(minConfidence), Double(rectangle.confidence)),
                        "bbox": [bbox.x, bbox.y, bbox.width, bbox.height],
                        "bboxNormalized": true,
                        "source": "ios-vision-rect-fallback"
                    ]

                    if let worldPosition = worldPosition {
                        detection["worldPosition"] = worldPosition
                        detection["worldPositionAvailable"] = true
                        if let distanceMeters = distanceMetersForWorldPosition(worldPosition) {
                            detection["distanceMeters"] = distanceMeters
                        }
                    } else {
                        detection["worldPositionAvailable"] = false
                    }

                    rectangleDetections.append(detection)
                }

                return .success((rectangleDetections, labels))
            } catch {
                return .failure(primaryError)
            }
        }
    }

    private func classifyRegionLabel(
        pixelBuffer: CVPixelBuffer,
        orientation: CGImagePropertyOrientation,
        bbox: (x: Double, y: Double, width: Double, height: Double),
        minConfidence: Float
    ) -> (label: String, confidence: Double)? {
        let visionY = max(0.0, min(1.0, 1.0 - bbox.y - bbox.height))
        let roi = CGRect(
            x: max(0.0, min(1.0, bbox.x)),
            y: visionY,
            width: max(0.0, min(1.0, bbox.width)),
            height: max(0.0, min(1.0, bbox.height))
        )

        guard roi.width > 0.02, roi.height > 0.02 else {
            return nil
        }

        do {
            let request = VNClassifyImageRequest()
            request.regionOfInterest = roi

            let handler = VNImageRequestHandler(
                cvPixelBuffer: pixelBuffer,
                orientation: orientation,
                options: [:]
            )
            try handler.perform([request])

            guard let best = request.results?.first else {
                return nil
            }

            let confidence = Double(best.confidence)
            guard confidence >= Double(max(0.25, minConfidence * 0.75)) else {
                return nil
            }

            let label = best.identifier.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
            guard !label.isEmpty else {
                return nil
            }

            return (label: label, confidence: confidence)
        } catch {
            return nil
        }
    }

    private func imageOrientationForDevice() -> CGImagePropertyOrientation {
        switch UIDevice.current.orientation {
        case .portraitUpsideDown:
            return .left
        case .landscapeLeft:
            return .up
        case .landscapeRight:
            return .down
        case .portrait:
            return .right
        default:
            return .right
        }
    }

    private func normalizedTopLeftBoundingBox(_ rect: CGRect) -> (x: Double, y: Double, width: Double, height: Double) {
        let clampedX = max(0.0, min(1.0, Double(rect.origin.x)))
        let clampedY = max(0.0, min(1.0, Double(rect.origin.y)))
        let clampedWidth = max(0.0, min(1.0, Double(rect.size.width)))
        let clampedHeight = max(0.0, min(1.0, Double(rect.size.height)))
        let topLeftY = max(0.0, min(1.0, 1.0 - clampedY - clampedHeight))
        return (clampedX, topLeftY, clampedWidth, clampedHeight)
    }

    private func worldPositionForNormalizedBoundingBox(
        _ bbox: (x: Double, y: Double, width: Double, height: Double)
    ) -> [String: Double]? {
        var result: [String: Double]?

        let resolvePosition = {
            guard let sceneView = self.sceneView else {
                return
            }

            guard sceneView.bounds.width > 1.0, sceneView.bounds.height > 1.0 else {
                return
            }

            let centerX = CGFloat(max(0.0, min(1.0, bbox.x + bbox.width * 0.5)))
            let centerY = CGFloat(max(0.0, min(1.0, bbox.y + bbox.height * 0.5)))
            let point = CGPoint(
                x: centerX * sceneView.bounds.width,
                y: centerY * sceneView.bounds.height
            )

            if let rayQuery = sceneView.raycastQuery(
                from: point,
                allowing: .estimatedPlane,
                alignment: .any
            ) {
                let rayHits = sceneView.session.raycast(rayQuery)
                if let rayHit = rayHits.first {
                    let position = rayHit.worldTransform.columns.3
                    result = [
                        "x": Double(position.x),
                        "y": Double(position.y),
                        "z": Double(position.z)
                    ]
                    return
                }
            }

            let sceneHitOptions: [SCNHitTestOption: Any] = [
                .firstFoundOnly: true
            ]

            if let sceneHit = sceneView.hitTest(point, options: sceneHitOptions).first {
                let world = sceneHit.worldCoordinates
                result = [
                    "x": Double(world.x),
                    "y": Double(world.y),
                    "z": Double(world.z)
                ]
                return
            }

            let arHits = sceneView.hitTest(
                point,
                types: [.existingPlaneUsingGeometry, .featurePoint]
            )

            if let arHit = arHits.first {
                let position = arHit.worldTransform.columns.3
                result = [
                    "x": Double(position.x),
                    "y": Double(position.y),
                    "z": Double(position.z)
                ]
            }
        }

        if Thread.isMainThread {
            resolvePosition()
        } else {
            DispatchQueue.main.sync(execute: resolvePosition)
        }

        return result
    }

    private func distanceMetersForWorldPosition(_ worldPosition: [String: Double]) -> Double? {
        guard
            let x = worldPosition["x"],
            let y = worldPosition["y"],
            let z = worldPosition["z"]
        else {
            return nil
        }

        var distance: Double?

        let resolveDistance = {
            guard let sceneView = self.sceneView else {
                return
            }

            guard let currentFrame = sceneView.session.currentFrame else {
                return
            }

            let camera = currentFrame.camera.transform.columns.3
            let dx = Double(camera.x) - x
            let dy = Double(camera.y) - y
            let dz = Double(camera.z) - z
            distance = sqrt(dx * dx + dy * dy + dz * dz)
        }

        if Thread.isMainThread {
            resolveDistance()
        } else {
            DispatchQueue.main.sync(execute: resolveDistance)
        }

        return distance
    }

    private func buildStatusLocked() -> [String: Any] {
        let pointsCaptured = meshAnchors.values.reduce(0) { $0 + $1.geometry.vertices.count }
        let trianglesCaptured = meshAnchors.values.reduce(0) { $0 + $1.geometry.faces.count }
        let elapsedMs = startedAt.map { Int(Date().timeIntervalSince($0) * 1000.0) } ?? 0
        let progress = min(100.0, Double(pointsCaptured) / 50000.0)
        var payload: [String: Any] = [
            "previewing": previewing,
            "running": running,
            "maxDistanceMeters": maxScanDistanceMeters,
            "detailLevel": scanDetailLevel,
            "pointsCaptured": pointsCaptured,
            "trianglesCaptured": trianglesCaptured,
            "anchorCount": meshAnchors.count,
            "elapsedMs": elapsedMs,
            "progress": progress,
            "objectDetectionEnabled": objectDetectionEnabled,
            "textRecognitionEnabled": textRecognitionEnabled
        ]

        return payload
    }

    private func buildObjectDetectionStatusLocked(error: String? = nil) -> [String: Any] {
        var payload: [String: Any] = [
            "enabled": objectDetectionEnabled,
            "minConfidence": objectDetectionMinConfidence,
            "intervalMs": objectDetectionIntervalMs,
            "detections": latestObjectDetections,
            "labels": latestObjectLabels,
            "updatedAtMs": latestObjectDetectionUpdatedAtMs
        ]

        if let error = error, !error.isEmpty {
            payload["error"] = error
        }

        return payload
    }

    private func buildTextRecognitionStatusLocked(error: String? = nil) -> [String: Any] {
        var payload: [String: Any] = [
            "enabled": textRecognitionEnabled,
            "intervalMs": textRecognitionIntervalMs,
            "text": latestRecognizedText,
            "blocks": latestRecognizedTextBlocks,
            "updatedAtMs": latestTextRecognitionUpdatedAtMs
        ]

        if let error = error, !error.isEmpty {
            payload["error"] = error
        }

        return payload
    }

    private func sanitizeScanDistance(_ distance: Float) -> Float {
        return min(10.0, max(1.0, distance))
    }

    private func sanitizeDetailLevel(_ detailLevel: String) -> String {
        let normalized = detailLevel.lowercased()

        if normalized == "fast" || normalized == "balanced" || normalized == "high" {
            return normalized
        }

        return "balanced"
    }

    private func sanitizeObjectDetectionConfidence(_ confidence: Float) -> Float {
        return min(0.95, max(0.2, confidence))
    }

    private func sanitizeObjectDetectionInterval(_ intervalMs: Int) -> Int {
        return min(3000, max(250, intervalMs))
    }

    private func sanitizeTextRecognitionInterval(_ intervalMs: Int) -> Int {
        return min(3500, max(300, intervalMs))
    }

    private func clampUnit(_ value: Double) -> Double {
        return min(1.0, max(0.0, value))
    }

    private func distance(from first: simd_float4x4, to second: simd_float4x4) -> Float {
        let a = SIMD3<Float>(first.columns.3.x, first.columns.3.y, first.columns.3.z)
        let b = SIMD3<Float>(second.columns.3.x, second.columns.3.y, second.columns.3.z)
        return simd_distance(a, b)
    }

    private func vertex(at index: Int, source: ARGeometrySource) -> SIMD3<Float> {
        let pointer = source.buffer.contents().advanced(by: source.offset + source.stride * index)
        return pointer.assumingMemoryBound(to: SIMD3<Float>.self).pointee
    }

    private func indexCountPerPrimitive(for _: ARGeometryElement) -> Int {
        // ARMeshGeometry faces are triangles; avoid SDK-specific enum cases here.
        return 3
    }

    private func faceIndices(for faceIndex: Int, faces: ARGeometryElement) -> [UInt32] {
        let indicesPerPrimitive = indexCountPerPrimitive(for: faces)
        let primitiveOffset = faceIndex * indicesPerPrimitive * faces.bytesPerIndex
        let pointer = faces.buffer.contents().advanced(by: primitiveOffset)

        var indices: [UInt32] = []
        indices.reserveCapacity(indicesPerPrimitive)

        for indexOffset in 0..<indicesPerPrimitive {
            let byteOffset = indexOffset * faces.bytesPerIndex

            if faces.bytesPerIndex == 2 {
                let value = pointer.load(fromByteOffset: byteOffset, as: UInt16.self)
                indices.append(UInt32(value))
            } else {
                let value = pointer.load(fromByteOffset: byteOffset, as: UInt32.self)
                indices.append(value)
            }
        }

        return indices
    }
}

@objc(LidarScannerPlugin)
class LidarScannerPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "LidarScannerPlugin"
    let jsName = "LidarScanner"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getCapabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestCameraPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startPreview", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopPreview", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startScan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopScan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getScanStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exportScan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listSavedModels", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteSavedModel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startObjectDetection", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopObjectDetection", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getObjectDetectionStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startTextRecognition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopTextRecognition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getTextRecognitionStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addListener", returnType: CAPPluginReturnCallback),
        CAPPluginMethod(name: "removeAllListeners", returnType: CAPPluginReturnPromise)
    ]

    private let scanManager = LidarScanSessionManager.shared

    override public func load() {
        scanManager.setObjectDetectionListener { [weak self] payload in
            self?.notifyListeners("objectDetections", data: payload)
        }
        scanManager.setTextRecognitionListener { [weak self] payload in
            self?.notifyListeners("recognizedText", data: payload)
        }
    }

    @objc func getCapabilities(_ call: CAPPluginCall) {
        let arSupported = ARWorldTrackingConfiguration.isSupported

        var lidarSupported = false
        var meshReconstructionSupported = false
        var depthApi = "none"

        if #available(iOS 13.4, *) {
            lidarSupported = ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
            meshReconstructionSupported = ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh)
            depthApi = lidarSupported ? "ARKit Scene Depth" : "none"
        }

        call.resolve([
            "platform": "ios",
            "arEngine": "ARKit",
            "arSupported": arSupported,
            "lidarSupported": lidarSupported,
            "meshReconstructionSupported": meshReconstructionSupported,
            "depthApi": depthApi,
            "cameraAvailable": true,
            "nativePreview": true,
            "detailLevels": ["fast", "balanced", "high"],
            "nativeObjectDetection": true,
            "nativeTextRecognition": true
        ])
    }

    @objc func requestCameraPermission(_ call: CAPPluginCall) {
        let status = AVCaptureDevice.authorizationStatus(for: .video)

        switch status {
        case .authorized:
            call.resolve([
                "granted": true,
                "status": "granted"
            ])
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async {
                    call.resolve([
                        "granted": granted,
                        "status": granted ? "granted" : "denied"
                    ])
                }
            }
        case .denied:
            call.resolve([
                "granted": false,
                "status": "denied"
            ])
        case .restricted:
            call.resolve([
                "granted": false,
                "status": "restricted"
            ])
        @unknown default:
            call.resolve([
                "granted": false,
                "status": "unknown"
            ])
        }
    }

    @objc func startPreview(_ call: CAPPluginCall) {
        let permission = AVCaptureDevice.authorizationStatus(for: .video)

        if permission != .authorized {
            call.reject("Camera permission not granted. Call requestCameraPermission first.")
            return
        }

        do {
            call.resolve(try scanManager.startPreview())
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func stopPreview(_ call: CAPPluginCall) {
        call.resolve(scanManager.stopPreview())
    }

    @objc func startScan(_ call: CAPPluginCall) {
        let permission = AVCaptureDevice.authorizationStatus(for: .video)

        if permission != .authorized {
            call.reject("Camera permission not granted. Call requestCameraPermission first.")
            return
        }

        let maxDistanceMeters = Float(call.getDouble("maxDistanceMeters") ?? 5.0)
        let detailLevel = call.getString("detailLevel") ?? "high"

        do {
            try scanManager.start(
                maxDistanceMeters: maxDistanceMeters,
                detailLevel: detailLevel
            )
            call.resolve(scanManager.status())
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func stopScan(_ call: CAPPluginCall) {
        call.resolve(scanManager.stop())
    }

    @objc func getScanStatus(_ call: CAPPluginCall) {
        call.resolve(scanManager.status())
    }

    @objc func exportScan(_ call: CAPPluginCall) {
        do {
            call.resolve(try scanManager.exportOBJ())
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func listSavedModels(_ call: CAPPluginCall) {
        call.resolve([
            "models": scanManager.listSavedModels()
        ])
    }

    @objc func deleteSavedModel(_ call: CAPPluginCall) {
        let filePath = call.getString("filePath") ?? ""

        do {
            call.resolve(try scanManager.deleteSavedModel(filePath: filePath))
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func startObjectDetection(_ call: CAPPluginCall) {
        let minConfidence = Float(call.getDouble("minConfidence") ?? 0.55)
        let intervalMs = call.getInt("intervalMs") ?? 900
        call.resolve(scanManager.startObjectDetection(minConfidence: minConfidence, intervalMs: intervalMs))
    }

    @objc func stopObjectDetection(_ call: CAPPluginCall) {
        call.resolve(scanManager.stopObjectDetection())
    }

    @objc func getObjectDetectionStatus(_ call: CAPPluginCall) {
        call.resolve(scanManager.objectDetectionStatus())
    }

    @objc func startTextRecognition(_ call: CAPPluginCall) {
        let intervalMs = call.getInt("intervalMs") ?? 1100
        call.resolve(scanManager.startTextRecognition(intervalMs: intervalMs))
    }

    @objc func stopTextRecognition(_ call: CAPPluginCall) {
        call.resolve(scanManager.stopTextRecognition())
    }

    @objc func getTextRecognitionStatus(_ call: CAPPluginCall) {
        call.resolve(scanManager.textRecognitionStatus())
    }
}
