
export interface Metadata {
    name: string;
    namespace: string;
};

export interface Pod {
    metadata: Metadata;
}

export interface Container {
    name: string;
    image: string;
}

export interface ServiceSpec {
    selector: { [key: string]: string; };
}

export interface Service {
    metadata: Metadata;
    spec: ServiceSpec;
}