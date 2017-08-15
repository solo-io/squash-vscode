'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as shelljs from 'shelljs';
import * as pickitems from './pickitems';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "vscode-smash" is now active!');

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with  registerCommand
    // The commandId parameter must match the command field in package.json
    let se = new SquashExtention();
    const subscriptions = [
        vscode.commands.registerCommand('vs-squash.attachToPod', () => { se.attachToPod(); }),
        vscode.commands.registerCommand('vs-squash.startServiceWatch', () => { se.startServiceWatch(); }),
        vscode.commands.registerCommand('vs-squash.waitForServiceSession', () => { se.waitForServiceSession(); }),
        vscode.commands.registerCommand('vs-squash.stopWaitForServiceSession', () => { se.stopWaitForServiceSession(); })
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
        vscode.window.showErrorMessage(err.message);
    }
};


function exec(cmd): Promise<any> {
    console.log("Executing: " + cmd);
    let promise = new Promise((resolve, reject) => {
        let handler = function (code, stdout, stderr) {
            if (code !== 0) {
                reject(new ExecError(code, stderr));
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

    constructor(code: number, stderr: string) {
        super(stderr.trim());

        // Set the prototype explicitly.
        Object.setPrototypeOf(this, ExecError.prototype);

        this.code = code;
        this.stderr = stderr;
    }

    getCode() {
        return this.code;
    }

    getStderr() {
        return this.stderr;
    }

}


function kubectl_get(cmd: string, ...args: string[]): Promise<any> {
    return kubectl("get -o json " + cmd + " " + args.join(" ")).then(JSON.parse);
}

function kubectl(cmd): Promise<any> {
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
    let remoteparts = remote.split(":");
    if (remoteparts.length != 2) {
        throw new Error('Invalid remote');
    }
    let pod = remoteparts[0];
    let podport = remoteparts[1];

    let cmd = get_conf_or("kubectl-path", "kubectl") + " port-forward " + ` ${pod} :${podport} `;
    console.log("Executing: " + cmd);
    let p = new Promise<number>((resolve, reject) => {
        let resolved = false;
        let handler = function (code, stdout, stderr) {
            if (resolved != true) {
                if (code !== 0) {
                    reject(new ExecError(code, stderr));
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

function squash(cmd): Promise<any> {
    let url = get_conf_or("squash-server-url", "");

    if (url) {
        url = " --url=" + url
    }

    return exec(get_conf_or("squash-path", "squash") + url + " --json=true " + cmd).then(JSON.parse);
}

class WaitWidget {

    private _statusBarItem: vscode.StatusBarItem;

    public showWaiting() {

        // Create as needed
        if (!this._statusBarItem) {
            this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
            this._statusBarItem.text = "⏱️ Waiting for Squash session"
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

    constructor() {
        this.waiter = new WaitWidget();
        this.stopWaiting = false;
    }


    selectPod(): Promise<any> {
        return this.getPods().then((pods) => {

            let podoptions: vscode.QuickPickOptions = {
                placeHolder: "Please select a pod",
            };

            let podItems: pickitems.PodPickItem[] = [];
            for (let pod of pods) {
                podItems.push(new pickitems.PodPickItem(pod));
            }

            return vscode.window.showQuickPick(podItems, podoptions).then((item) => {
                if (item) {
                    return item.pod;
                } else {
                    return undefined;
                }
            });
        });
    }

    selectContainer(pod): Promise<any> {

        let containerItems: pickitems.ContainerPickItem[] = [];
        let selectedpod = pod;
        for (let container of selectedpod["spec"]["containers"]) {
            containerItems.push(new pickitems.ContainerPickItem(container))
        }

        let conoptions: vscode.QuickPickOptions = {
            placeHolder: "Please select a container",
        };
        return new Promise<pickitems.ContainerPickItem>((resolve, reject) => {
            vscode.window.showQuickPick(containerItems, conoptions).then((item) => { resolve(item); });
        }).then((item) => {
            if (item) {
                return item.container;
            } else {
                return undefined;
            }
        });
    }

    chooseService(): Promise<any> {

        let options: vscode.QuickPickOptions = {
            placeHolder: "Please select a service to watch",
        };

        return this.getServices().then((services) => {

            let serviceItems: pickitems.KubePickItem[] = [];
            for (let service of services) {
                serviceItems.push(new pickitems.KubePickItem(service, "service"));
            }

            return vscode.window.showQuickPick(serviceItems, options);
        }).then((service) => {
            if (service) {
                return service.obj;
            }
        });
    }
    chooseDebugger(): Thenable<string> {
        let debuggers = ["gdb", "dlv"]
        return vscode.window.showQuickPick(debuggers);
    }


    chooseImage(images?: string[]): Promise<string> {
        const custom = "-- custom --";

        let options: vscode.InputBoxOptions = {
            prompt: "Please input the image, as appears in the pod spec.",
        };

        let handlecustom = (image: pickitems.ImagePickItem): Promise<string> => {
            if (image) {
                if (image.name == custom) {
                    return new Promise<string>((resolve, reject) => {

                        return vscode.window.showInputBox(options).then(
                            (img) => {
                                if (img) {
                                    return resolve(img);
                                }
                            }
                        );
                    });
                } else {
                    return Promise.resolve(image.name);
                }
            }
        };

        let imageoptions: vscode.QuickPickOptions = {
            placeHolder: "Please select the container image",
        };

        if (images) {

            images.push(custom);
            return new Promise<string>((resolve, reject) => {
                return vscode.window.showQuickPick(this.imagesToQuickPick(images), imageoptions).then(handlecustom).then((s) => resolve(s));
            });
        } else {
            return this.getImages().then((images) => {
                images.push(custom);
                return vscode.window.showQuickPick(this.imagesToQuickPick(images), imageoptions);
            }).then(handlecustom);
        }
    }


    imagesToQuickPick(images: string[]): pickitems.ImagePickItem[] {
        let picks: pickitems.ImagePickItem[] = []
        images.forEach((i) => { picks.push(new pickitems.ImagePickItem(i)) });
        return picks
    }

    startServiceWatch() {
        /*
         * TODO: As soon as we support more then one container cluster orchestration, add a question here asking
         * which one to use. 
         * 
         *  1. kubernetes
         *  2. cloud foundry
         *  3. docker swarm
         *  4. mesos
         */
        let promise = this.chooseService().then((service) => {
            if (service) {
                return this.getImagesOfService(service).then(
                    (images) => {
                        if (images) {
                            return this.chooseImage(images).then((img) => {
                                if (img) {
                                    return this.chooseDebugger().then((dbgr) => {
                                        if (dbgr) {
                                            let servicename = service["metadata"]["name"]
                                            return squash(`app add "${servicename}" "${img}" "${dbgr}"`);
                                        }
                                    });
                                }
                            });
                        }
                    }
                );
            }
        });

        promise.then((dbgconfig) => {
            if (dbgconfig) {
                let id = dbgconfig.id;
                vscode.window.showInformationMessage('Added debug config id:' + id);
                return vscode.commands.executeCommand(
                    'vs-squash.waitForServiceSession',
                    dbgconfig
                );
            }

        })

        return promise.catch(handleError);
    }

    stopWaitForServiceSession() {
        vscode.window.showInformationMessage("Stop waiting for session?", "Yes", "No").then(
            (answer) => {
                if (answer == "Yes") {
                    this.cancelWaiting();
                }
            }
        );
    }

    waitForServiceSession(dbgconfig = null) {

        if (dbgconfig) {
            return this.waitAndDebug(dbgconfig.id, 60 * 60);
        }

        let promise = squash(`app list`).then(
            (dbgconfiglist) => {
                let dbgItems: pickitems.DbgConfigPickItem[] = [];

                for (let dbgconfig of dbgconfiglist) {
                    if (dbgconfig["attachment"]["type"] == "service") {
                        dbgItems.push(new pickitems.DbgConfigPickItem(dbgconfig));
                    }
                }
                return vscode.window.showQuickPick(dbgItems).then((item) => {
                    if (item) {
                        // wait for an hour
                        return this.waitAndDebug(item.dbgconfig.id, 60 * 60);
                    }
                });


            }
        );


        return promise.catch(handleError);
    }


    attachToPod() {
        // ask the user to chose a pod
        // and image id

        let containerPromise = this.selectPod().then((pod) => {
            if (pod) {
                return this.selectContainer(pod).then((container) => {
                    if (container) {
                        let containerimage = container["image"];
                        let containername = container["name"];
                        let podname = pod["metadata"]["name"];
                        console.log(`running debug container ${containerimage}, ${podname}, ${containername}`);
                        return this._debugContainer(containerimage, podname, containername);
                    }
                });
            }
        });

        containerPromise.catch(handleError);

    }

    getImages(): Promise<string[]> {
        return exec("docker images --format '{{.Repository}}:{{.Tag}}' --filter='dangling=false' -q").then((output) => {
            let output2: string[] = output.split("\n");
            output2 = output2.filter(v => v != '');
            return output2;
        });
    }

    registerApp(imageid, breakpoints) {

    }

    debugContainer(imageid, pod) {
        // TODO: verify that coontainer exist and image id matches app
        // or perhaps not request container at all..

        this.findcontainer(imageid, pod).then(
            (container) => {
                this._debugContainer(imageid, pod, container);
            }
        );
    }

    cancelWaiting() {
        this.stopWaiting = true;
        this.waiter.hideWaiting();
    }

    waitForAttachment(token, timeout): Promise<any> {
        let deadline = process.hrtime();
        deadline[0] += timeout;
        return this._waitForAttachmentDeadline(token, deadline)
    }

    _waitForAttachmentDeadline(token, deadline): Promise<any> {
        if (this.stopWaiting) {
            return Promise.resolve(null)
        }

        let waitcmd = `session  wait ${token} `;

        return squash(waitcmd).then((res) => {
            console.log(`Wait returned: ${res} `)
            return res;
        }).catch((err) => {
            let errinfojson = JSON.parse(err.stderr);
            if (errinfojson["Type"] == "Timeout") {
                let nowtime = process.hrtime();
                if (nowtime[0] > deadline[0]) {
                    throw err;
                }
                return this._waitForAttachmentDeadline(token, deadline)
            }
            throw err;
        });
    }

    waitAndDebug(token, timeout = 60) {
        this.stopWaiting = false;
        this.waiter.showWaiting();
        return this.waitForAttachment(token, timeout).then((dbgsession) => {
            if (this.stopWaiting == true) {
                return;
            }
            this.waiter.hideWaiting();
            if (!dbgsession) {
                return;
            }
            let remote = dbgsession["url"];
            let dbgconfigid = dbgsession["debugConfigId"];
            console.log(`Attachment waited! dbgconfigid: "${token}";remote: ${remote}`);

            return squash("app list " + dbgconfigid).then((dbgconfig) => {

                // TODO: close the forwarder in the end of debugsession.
                // not sure how to tell when the debug session ends. most chances the pod will
                // die with it, thus killing the forwarder, making this not a big problem.
                return kubectl_portforward(remote).then(
                    (number) => {
                        console.log("Local port forward for debug server is: localhost:" + number);
                        vscode.window.showInformationMessage('Starting debug session' + remote);

                        let debuggerconfig;
                        if (dbgconfig["debugger"] == "dlv") {
                            debuggerconfig = {
                                name: "Remote",
                                type: "go",
                                request: "launch",
                                mode: "remote",
                                port: number,
                                host: "127.0.0.1",
                                program: "${workspaceRoot}",
                                env: {},
                                args: [],
                                showLog: true
                            };
                        } else {
                            debuggerconfig = {
                                type: "gdb",
                                request: "attach",
                                name: "Attach to gdbserver",
                                target: "localhost:" + number,
                                remote: true,
                                cwd: vscode.workspace.rootPath
                            };
                        }

                        return vscode.commands.executeCommand(
                            'vscode.startDebug',
                            debuggerconfig
                        );

                    });
            });
        }).catch((reason) => {
            this.waiter.hideWaiting();
            throw reason;
        });
    }

    _debugContainer(imageid, pod, container): Promise<any> {
        return this.requestAttachment(imageid, pod, container).then(
            (token) => {
                if (token) {
                    console.log(`requestAttachment token ${token}`);
                    return this.waitAndDebug(token);
                }
                throw new Error('Attachment token not found');

            }).catch(handleError);

    }

    getPods(): Promise<any> {
        return kubectl_get("pods").then((podsjson) => {
            return podsjson["items"];
        });
    }

    getImagesOfService(service: any): Promise<string[]> {
        if (service) {
            return this.selectPods(service["spec"]["selector"]).then(
                (pods) => {
                    return this.getImagesFromPods(pods)
                }
            );
        }
    }

    getServices(): Promise<any[]> {
        return kubectl_get("services").then((servicesjson) => {
            return servicesjson["items"];
        });
    }

    selectPods(selectorMap: any): Promise<any[]> {
        var selectors: string[] = [];
        for (let property in selectorMap) {
            if (selectorMap.hasOwnProperty(property)) {
                selectors.push(property + "=" + selectorMap[property]);
            }
        }

        return kubectl_get("pods", "-l", selectors.join(",")).then((podsjson) => {
            return podsjson["items"];
        });
    }

    getImagesFromPods(pods: any[]): string[] {
        var images: Set<string> = new Set();
        pods.forEach((pod) => {
            pod["spec"]["containers"].forEach((container) => {
                images.add(container["image"])
            });
        });

        let imagearray = Array.from(images);
        imagearray.sort()
        return imagearray;
    }



    findcontainer(imageid, podname): Promise<string> {
        return this.getPods().then((pods) => {
            for (let pod of pods) {
                if (pod["metadata"]["name"] == podname) {
                    for (let container of pod["spec"]["containers"]) {
                        if (imageid == container["image"]) {
                            console.log("found container" + container["name"]);
                            return container["name"]
                        }
                    }
                    throw new Error('Container not found');
                }
            }
            throw new Error('Pod not found');
        });
    }

    requestAttachment(imgid, pod, container): Promise<string> {
        console.log(`requestAttachment ${imgid}, ${pod}, ${container}`);
        return new Promise((resolve, reject) => {
            this.chooseDebugger().then((dbgr) => {
                if (dbgr) {
                    squash(`app attach ${imgid} ${pod} ${container} ${dbgr} `).then((res) => {
                        return resolve(res["id"]);
                    });
                }
            });
        });
    }

}


