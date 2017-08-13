import * as vscode from 'vscode';
import * as shelljs from 'shelljs';

export class KubePickItem implements vscode.QuickPickItem {
    label: string;
    description: string;
    detail?: string;
    name: string;
    obj: any;

    constructor(obj: any, desc: string) {
        this.name = obj["metadata"]["name"];
        this.label = this.name;
        this.description = desc;
        this.obj = obj;
    }
}

export class PodPickItem implements vscode.QuickPickItem {
    label: string;
    description: string;
    detail?: string;

    pod: any;

    constructor(pod: any) {
        let podname = pod["metadata"]["name"];
        let nodename = pod["spec"]["nodeName"];
        this.label = `${podname} (${nodename})`;
        this.description = "pod";
        this.pod = pod;
    }
}

export class ContainerPickItem implements vscode.QuickPickItem {
    label: string;
    description: string;
    detail?: string;

    container: any;

    constructor(container: any) {
        this.label = container["name"] + " - " + container["image"];
        this.description = "container";
        this.container = container;
    }
}



export class ImagePickItem implements vscode.QuickPickItem {
    label: string;
    description: string;
    detail?: string;
    name: string;

    constructor(img: string) {
        this.name = img
        this.label = this.name;
        this.description = "image";
    }
}

export class DbgConfigPickItem implements vscode.QuickPickItem {
    label: string;
    description: string;
    detail?: string;

    dbgconfig: any;

    constructor(dbgconfig: any) {
        this.label = dbgconfig["attachment"]["name"]
        this.description = "debug-config";
        this.dbgconfig = dbgconfig;
    }
}
