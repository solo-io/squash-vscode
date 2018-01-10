'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as shelljs from 'shelljs';
import * as pickitems from './pickitems';
import { setTimeout } from 'timers';

import * as kube from './kube-interfaces';
import * as squashinterface from './squash-interfaces';

export class RemoteDebuggerAddress {
    podName : string;
    podNamespace : string;
    port: string;

    constructor(remote : string) {
        let remoteparts = remote.split(":");
        if (remoteparts.length != 2) {
            throw new Error('Invalid remote '+remote);
        }
        let podaddr = remoteparts[0];
        this.port = remoteparts[1];
    
        let podparts = podaddr.split(".");
        if ((podparts.length != 2) && (podparts.length != 1)) {
            throw new Error('Invalid remote pod '+remote);
        }
        this.podNamespace = "squash";
        this.podName = podparts[0];
        if (podparts.length == 2) {
            this.podNamespace = podparts[1];
        }
    }
}

function asyncTimeout(ms: number): Promise<any> {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, ms);
    });
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "squash-vscode" is now active!');

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with  registerCommand
    // The commandId parameter must match the command field in package.json
    let se = new SquashExtention(context);
    const subscriptions = [
        vscode.commands.registerCommand('vs-squash.attachToPod', () => { se.attachToPod(); }),
        vscode.commands.registerCommand('vs-squash.startWatchForImage', () => { se.startWatchForImage(); }),
        vscode.commands.registerCommand('vs-squash.stopWaitForServiceSession', () => { se.stopWaitForServiceSession(); }),
    ];

    subscriptions.forEach((element) => {
        context.subscriptions.push(element);
    }, this);
}

// this method is called when your extension is deactivated
export function deactivate() {
}

const handleError = (err) => {
    if (err) {
        if (err.message) {
            vscode.window.showErrorMessage(err.message);
        } else {
            vscode.window.showErrorMessage("Unknown error has occurred");
        }
    }
};


function exec(cmd): Promise<any> {
    console.log("Executing: " + cmd);
    let promise = new Promise((resolve, reject) => {
        let handler = function (code, stdout, stderr) {
            if (code !== 0) {
                reject(new ExecError(code, stdout, stderr));
            } else {
                resolve(stdout);
            }
        };

        let options = { async: true };
        let child = shelljs.exec(cmd, options, handler);

    });

    return promise;
}

// https://github.com/Microsoft/TypeScript/wiki/Breaking-Changes#extending-built-ins-like-error-array-and-map-may-no-longer-work
class ExecError extends Error {
    code: number;
    stderr: string;
    stdout: string;

    constructor(code: number, stdout: string, stderr: string) {
        super((stdout+stderr).trim());

        // Set the prototype explicitly.
        Object.setPrototypeOf(this, ExecError.prototype);

        this.code = code;
        this.stderr = stderr;
        this.stdout = stdout;
    }
}


function kubectl_get<T=any>(cmd: string, ...args: string[]): Promise<T> {
    return kubectl("get -o json " + cmd + " " + args.join(" ")).then(JSON.parse);
}

function kubectl(cmd): Promise<string> {
    return exec(get_conf_or("kubectl-path", "kubectl") + " " + cmd);
}


function get_conf_or(k, d) {
    let config = vscode.workspace.getConfiguration('vs-squash');
    let v = config[k];
    if (!v) {
        return d;
    }
    return v;
}

function get_kubectl_proxy_options(): any {
    let proxy = get_conf_or("kubectl-proxy", "");
    if (proxy) {
        return { env: { http_proxy: proxy } }
    }
    return null
}

function kubectl_portforward(remote): Promise<number> {

    let remoteParsed = new RemoteDebuggerAddress(remote);

    let cmd = get_conf_or("kubectl-path", "kubectl") + ` --namespace=${remoteParsed.podNamespace} port-forward ${remoteParsed.podName} :${remoteParsed.port}`;
    console.log("Executing: " + cmd);
    let p = new Promise<number>((resolve, reject) => {
        let resolved = false;
        let handler = function (code, stdout, stderr) {
            if (resolved != true) {
                if (code !== 0) {
                    reject(new ExecError(code, stdout, stderr));
                } else {
                    reject(new Error("Didn't receive port"));
                }
            } else {
                console.log(`port forward ended unexpectly: ${code} ${stdout} ${stderr} `)
            }
        };
        let proxyopts = get_kubectl_proxy_options();
        let child = shelljs.exec(cmd, proxyopts, handler);
        let stdout = "";
        child.stdout.on('data', function (data) {
            stdout += data;
            let portRegexp = /from\s+.+:(\d+)\s+->/g;
            let match = portRegexp.exec(stdout);
            if (!match != null) {
                resolved = true;
                resolve(parseInt(match[1]))
            }
        });
    });

    return p;
}

async function squash<T=any>(cmd): Promise<T> {
    let url = get_conf_or("squash-server-url", "");

    if (url) {
        url = " --url=" + url
    }

    const body = await exec(get_conf_or("squash-path", "squash") + url + " --json=true " + cmd);
    return JSON.parse(body);
}

class WaitWidget {

    private _statusBarItem: vscode.StatusBarItem;

    public showWaiting() {

        // Create as needed
        if (!this._statusBarItem) {
            this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
            this._statusBarItem.text = "⏱️ Waiting for Debug Attachment"
            this._statusBarItem.command = "vs-squash.stopWaitForServiceSession"
        }

        this._statusBarItem.show();
    }

    public hideWaiting() {
        this._statusBarItem.hide();
    }

    dispose() {
        this._statusBarItem.dispose();
    }
}

class SquashExtention {

    waiter: WaitWidget;
    stopWaiting: boolean;
    waitingFor: string;

    constructor(context: vscode.ExtensionContext) {
        this.waiter = new WaitWidget();
        this.stopWaiting = false;
    }


    async selectPod(): Promise<kube.Pod> {
        const pods = await this.getPods();

        let podoptions: vscode.QuickPickOptions = {
            placeHolder: "Please select a pod",
        };

        let podItems: pickitems.PodPickItem[] = [];
        for (let pod of pods) {
            podItems.push(new pickitems.PodPickItem(pod));
        }

        const item = await vscode.window.showQuickPick(podItems, podoptions);

        if (item) {
            return item.pod;
        } else {
            return undefined;
        }

    }

    async selectContainer(pod): Promise<kube.Container> {

        let containerItems: pickitems.ContainerPickItem[] = [];
        let selectedpod = pod;
        for (let container of selectedpod["spec"]["containers"]) {
            containerItems.push(new pickitems.ContainerPickItem(container))
        }

        let conoptions: vscode.QuickPickOptions = {
            placeHolder: "Please select a container",
        };

        const item = await vscode.window.showQuickPick(containerItems, conoptions);
        if (item) {
            return item.container;
        }
        return undefined;

    }

    async chooseService(): Promise<kube.Service> {

        let options: vscode.QuickPickOptions = {
            placeHolder: "Please select a service to watch",
        };

        const services = await this.getServices();

        let serviceItems: pickitems.KubePickItem[] = [];
        for (let service of services) {
            serviceItems.push(new pickitems.KubePickItem(service, "service"));
        }

        const service = await vscode.window.showQuickPick(serviceItems, options);
        if (service) {
            return service.obj;
        }
    }

    async chooseDebugger(): Promise<string> {
        let debuggers = ["gdb", "dlv", "java", "nodejs", "nodejs8"]
        const chosen = await vscode.window.showQuickPick(debuggers);
        return chosen;
    }


    async chooseImage(images: string[]): Promise<string> {
        const custom = "-- custom --";

        let options: vscode.InputBoxOptions = {
            prompt: "Please input the image, as appears in the pod spec.",
        };

        let handlecustom = async (image: pickitems.ImagePickItem): Promise<string> => {
            if (image) {
                if (image.name == custom) {
                    return await vscode.window.showInputBox(options);
                } else {
                    return image.name;
                }
            }
        };

        let imageoptions: vscode.QuickPickOptions = {
            placeHolder: "Please select the container image",
        };

        images.push(custom);
        const potentialchosenimage = await vscode.window.showQuickPick(this.imagesToQuickPick(images), imageoptions);
        return await handlecustom(potentialchosenimage);
    }


    imagesToQuickPick(images: string[]): pickitems.ImagePickItem[] {
        let picks: pickitems.ImagePickItem[] = []
        images.forEach((i) => { picks.push(new pickitems.ImagePickItem(i)) });
        return picks
    }

    async startWatchForImage() {
        try {

            const service = await this.chooseService();
            if (!service) {
                return;
            }
            const images = await this.getImagesOfService(service);
            if (!images) {
                return;
            }
            const img = await this.chooseImage(images);
            if (!img) {
                return;
            }
            const dbg = await this.chooseDebugger();
            if (!dbg) {
                return;
            }

            this.waiter.showWaiting();
            const dbgconfigname = await this.waitForDebugConfigWithImage(img, dbg);
            
            await this.waitAndDebug(dbgconfigname, 10);

        } catch (error) {
            handleError(error)
        }
    }

    async stopWaitForServiceSession() {
        const answer = await vscode.window.showInformationMessage("Stop waiting for session?", "Yes", "No")
        if (answer == "Yes") {
            this.cancelWaiting();
        }
    }

    async waitForDebugRequest(requestname): Promise<string> {
        for (; ;) {
            if (this.stopWaiting) {
                return;
            }
            const res = await squash<squashinterface.DebugRequest>(`list debugrequests  ${requestname}`);
            if (res.status.debug_attachment_ref) {
                return res.status.debug_attachment_ref;
            }

            await asyncTimeout(1000);
        }
    }

    async waitForDebugConfigWithImage(image: string, dbgr: string): Promise<string> {
        let pname = get_conf_or("process-name", "")
        const result = await squash<squashinterface.DebugRequest>(`debug-request ${image} ${dbgr} ${pname}`);
        if (!result) {
            throw new Error("can't create debug request");
        }
        let requestname = result.metadata.name;
        if (!requestname) {
            throw new Error("empty debug request name");
        }
        return await this.waitForDebugRequest(requestname);
    }

    async attachToPod() {
        // ask the user to chose a pod
        // and image id
        try {
            // TODO: merge selectPod and selectContainer
            // Get the debugger either in pod annotation or workspace config or debug adapter.
            const pod = await this.selectPod();
            if (pod) {
                const container = await this.selectContainer(pod)
                if (container) {
                    let containerimage = container.image;
                    let containername = container.name;
                    let podname = pod.metadata.name;
                    let podnamespace = pod.metadata.namespace;
                    console.log(`running debug container ${containerimage}, ${podname}, ${containername}`);
                    await this._debugContainer(containerimage, podnamespace, podname, containername);
                }
            }
        } catch (error) {
            handleError(error);
        }

    }

    async debugContainer(imageid, podnamespace, podname) {
        // TODO: verify that coontainer exist and image id matches app
        // or perhaps not request container at all..

        const container = await this.findcontainer(imageid, podnamespace, podname)
        await this._debugContainer(imageid, podnamespace, podname, container);
    }

    cancelWaiting() {
        this.stopWaiting = true;
        this.waiter.hideWaiting();
    }

    async waitForAttachment(dbgconfigid: string, timeout: number): Promise<squashinterface.DebugAttachment> {
        if (this.stopWaiting) {
            return;
        }
        
        if (!dbgconfigid) {
            throw new Error("Empty debug request name");
        }

        let deadline = process.hrtime();
        let nowtime;
        deadline[0] += timeout;

        let waitcmd = `wait ${dbgconfigid} `;
        for (; ;) {

            try {
                return await squash<squashinterface.DebugAttachment>(waitcmd);
            } catch (err) {
                let errinfojson = JSON.parse(err.stderr);
                if (errinfojson["Type"] == "Timeout") {
                    nowtime = process.hrtime();
                    if (nowtime[0] > deadline[0]) {
                        throw err;
                    }
                }
                if (this.stopWaiting === true) {
                    throw err;
                }
            }

        }
    }

    async waitAndDebug(dbgconfigid: string, timeout = 60) {
        this.stopWaiting = false as boolean;
        this.waitingFor = dbgconfigid;
        this.waiter.showWaiting();
        const debugattachment = await this.waitForAttachment(dbgconfigid, timeout);
        try {
            if (this.stopWaiting === true) {
                return;
            }
            this.waiter.hideWaiting();
            if (!debugattachment) {
                return;
            }

            if (debugattachment.status.state != "attached") {
                throw new Error('Failed to attach.');
            }

            let remote = debugattachment.status.debug_server_address;
            let dbgconfigid = debugattachment.metadata.name;
            console.log(`Attachment waited! dbgconfigid: "${dbgconfigid}";remote: ${remote}`);

            // TODO: close the forwarder in the end of debugsession.
            // not sure how to tell when the debug session ends. most chances the pod will
            // die with it, thus killing the forwarder, making this not a big problem.
            const localport = await kubectl_portforward(remote)
            console.log("Local port forward for debug server is: localhost:" + localport);
            vscode.window.showInformationMessage('Starting debug session: ' + remote);
            let remotepath = get_conf_or("remotePath", null);
            let localpath = vscode.workspace.rootPath;
            let debuggerconfig;
            switch (debugattachment.spec.debugger) {
                case "dlv":
                    debuggerconfig = {
                        name: "Remote",
                        type: "go",
                        request: "launch",
                        mode: "remote",
                        port: localport,
                        host: "127.0.0.1",
                        program: localpath,
                        remotePath: remotepath,
                        //      stopOnEntry: true,
                        env: {},
                        args: [],
                        showLog: true,
                        trace: "verbose"
                    };
                    break;
                case "java":
                    debuggerconfig = {
                        type: "java",
                        request: "attach",
                        name: "Attach to java process",
                        port: localport,
                        hostName: "127.0.0.1",                                                
                    };
                    break;
                case "nodejs":
                case "nodejs8":
                    debuggerconfig = {
                        type: "node",
                        request: "attach",
                        name: "Attach to Remote",
                        address: "127.0.0.1",
                        port: localport,
                        localRoot: localpath,
                        remoteRoot: remotepath                                         
                    };
                    break;
                case "gdb":
                    let autorun: string[] = null;
                    if (remotepath) {
                        autorun = [`set substitute-path "${remotepath}" "${localpath}"`];
                    }
                    debuggerconfig = {
                        type: "gdb",
                        request: "attach",
                        name: "Attach to gdbserver",
                        target: "localhost:" + localport,
                        remote: true,
                        cwd: localpath,
                        autorun: autorun
                    };
                    break;
                default:
                    throw new Error(`Unknown debugger ${debugattachment.spec.debugger}`);
            }

            let workspace : vscode.WorkspaceFolder;

            if (vscode.workspace.workspaceFolders.length == 0) {
                throw new Error("Can't start debugging without a project open");
            } else if (vscode.workspace.workspaceFolders.length == 1) {
                workspace = vscode.workspace.workspaceFolders[0];
            } else {
                let wfoptions: vscode.QuickPickOptions = {
                    placeHolder: "Please a project to debug",
                };
                let wfItems: pickitems.WorkspaceFolderPickItem[] = [];
                for (let wf of vscode.workspace.workspaceFolders) {
                    wfItems.push(new pickitems.WorkspaceFolderPickItem(wf));
                }

                const item = await vscode.window.showQuickPick(wfItems, wfoptions);

                if (item) {
                    workspace = item.obj;
                } else {
                    return;
                }
            }

            return vscode.debug.startDebugging(
                workspace,
                debuggerconfig
            );

        } catch (reason) {
            this.waiter.hideWaiting();
            throw reason;
        }
    }

    async _debugContainer(imageid, podnamespace, podname, container) {
        const dbgconfigid = await this.requestAttachment(imageid, podnamespace, podname, container);
        if (dbgconfigid) {
            console.log(`requestAttachment dbgconfigid ${dbgconfigid}`);
            return this.waitAndDebug(dbgconfigid);
        }
        throw new Error('Attachment dbgconfigid not found');
    }

    async getPods(): Promise<kube.Pod[]> {
        const podsjson = await kubectl_get<kube.PodList>("pods", "--all-namespaces");
        return podsjson.items;
    }

    async getImagesOfService(service: kube.Service): Promise<string[]> {
        if (service) {
            const pods = await this.selectPods(service.spec.selector);
            return this.getImagesFromPods(pods)
        }
    }

    async getServices(): Promise<kube.Service[]> {
        const servicesjson = await kubectl_get<kube.ServiceList>("services");
        return servicesjson.items;
    }

    async selectPods(selectorMap: any): Promise<kube.Pod[]> {
        var selectors: string[] = [];
        for (let property in selectorMap) {
            if (selectorMap.hasOwnProperty(property)) {
                selectors.push(property + "=" + selectorMap[property]);
            }
        }

        const podlist= await kubectl_get<kube.PodList>("pods", "-l", selectors.join(","));
        return podlist.items;
    }

    getImagesFromPods(pods: kube.Pod[]): string[] {
        var images: Set<string> = new Set();
        pods.forEach((pod) => {
            pod.spec.containers.forEach((container) => {
                images.add(container.image);
            });
        });

        let imagearray = Array.from(images);
        imagearray.sort()
        return imagearray;
    }

    async findcontainer(imageid, podnamespace, podname): Promise<string> {
        const pods = await this.getPods();
        for (let pod of pods) {
            const { metadata } = pod;
            if (metadata.name == podname && metadata.namespace == podnamespace) {
                for (let container of pod.spec.containers) {
                    if (imageid == container.image) {
                        console.log("found container" + container.name);
                        return container.name
                    }
                }
                throw new Error('Container not found');
            }
        }
        throw new Error('Pod not found');
    }

    async requestAttachment(imgid, podnamespace, podname, container): Promise<string> {
        console.log(`requestAttachment ${imgid}, ${podname}, ${container}`);

        const dbgr = await this.chooseDebugger();
        if (dbgr) {
            let pname = get_conf_or("process-name", "")
            const attachment = await squash(`debug-container --namespace=${podnamespace} ${imgid} ${podname} ${container} ${dbgr} ${pname}`);
            let name = attachment.metadata.name;
            return name;
        }
    }
}
