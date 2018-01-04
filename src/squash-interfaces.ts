
export interface Metadata {
    name: string;
    namespace: string;
};

export interface DebugRequest {
    metadata: Metadata;
}

export interface DebugAttachment {
    metadata: Metadata;
    spec: DebugAttachmentSpec;
    status: DebugAttachmentStatus;
}

export interface DebugAttachmentStatus {
    debug_server_address: string;
    state: string;
}
export interface DebugAttachmentSpec {
    debugger: string;
}
