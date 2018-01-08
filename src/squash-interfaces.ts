
export interface Metadata {
    name: string;
    namespace: string;
};

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

export interface DebugRequest {
    metadata: Metadata;
    status: DebugRequestStatus;
}

export interface DebugRequestStatus {
    debug_attachment_ref: string;
}
