'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as shelljs from 'shelljs';
import * as pdeadline from 'promise-deadline';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "vscode-smash" is now active!');

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with  registerCommand
    // The commandId parameter must match the command field in package.json
    const subscriptions = [
        vscode.commands.registerCommand('extension.sayHello', () => {
            // The code you place here will be executed every time your command is executed

            // Display a message box to the user
            vscode.window.showInformationMessage('Hello World!');
        }),
        vscode.commands.registerCommand('extension.attachToPod', attachToPod),
    ];


    subscriptions.forEach((element) => {
        context.subscriptions.push(element);
    }, this);
}

// this method is called when your extension is deactivated
export function deactivate() {
}

interface ClockInterface {
    currentTime: Date;
}

class PodPickItem implements vscode.QuickPickItem {
    label: string;
    description: string;
    detail?: string;

    pod: any;

    constructor(pod: any) {
        this.label = pod["metadata"]["name"] ;
        this.description = "pod" ;
        this.pod = pod;
     }
}

class ContainerPickItem implements vscode.QuickPickItem {
    label: string;
    description: string;
    detail?: string;

    container: any;

    constructor(container: any) {
        this.label = container["name"] + " - " + container["image"];
        this.description =  "container";
        this.container = container;
     }
}


function attachToPod() {
    // ask the user to chose a pod
    // and image id

    get_pods().then( (pods) => {
        let podItems : PodPickItem[] = [];
        for (let pod of pods) {
            podItems.push(new PodPickItem(pod))
        }
            
        return vscode.window.showQuickPick(podItems).then((value) => {
            if (value) {
            let containerItems : ContainerPickItem[] = [];
            let selectedpod =  value.pod;
            for (let container of selectedpod["spec"]["containers"]) {
                containerItems.push(new ContainerPickItem(container))
            }

            return vscode.window.showQuickPick(containerItems).then((value) => {
                if (value) {
                    let containerimage = value.container["image"];
                    let containername = value.container["name"];
                    let podname = selectedpod["metadata"]["name"];
                    console.log(`running debug container ${containerimage}, ${podname}, ${containername}`);
                    return _debugContainer(containerimage, podname, containername);
                }
            });
        }
    }
    );

}).catch((err)=>{
        vscode.window.showErrorMessage(err.message);
    });

/*

    vscode.window.showInputBox({ prompt: `Please provide: <imageid> <pod>` }).then((value) => {
        if (value) {
            let values = value.trim().split(/\s+/);
            if (values.length != 2) {
                console.log(values);
                vscode.window.showErrorMessage('Invalid number of arguments');
                return;
            }

            let image = values[0];
            let pod = values[1];
            debugContainer(image, pod);
        }
    });

    */
}

function registerApp(imageid, breakpoints) {

}

function debugContainer(imageid, pod) {
    // TODO: verify that coontainer exist and image id matches app
    // or perhaps not request container at all..

    findcontainer(imageid, pod).then(
        (container) => {
            _debugContainer(imageid, pod, container);
        }
    );
}

function _debugContainer(imageid, pod, container) {
    return requestAttachment(imageid, pod, container).then(
        (token) => {
            console.log(`requestAttachment token $(token)`);
            waitForAttachment(imageid, token).then(
                (remote) => {
                    console.log(`Attachment waited!`);
                    portforward(1234, remote).then(
                        // TODO: kill the port forward when debugging session ends
                        () => {
                            vscode.window.showInformationMessage('Starting debug session' + remote);

                            return vscode.commands.executeCommand(
                                'vscode.startDebug',
                                {
                                    type: "gdb",
                                    request: "attach",
                                    name: "Attach to gdbserver",
                                    executable: vscode.workspace.rootPath + "/target/debug/buggy",
                                    target: "localhost:1234",
                                    remote: true,
                                    cwd: vscode.workspace.rootPath
                                }
                            );
                        }

                    );
                }

            );
        }
    );

}

function get_pods(): Promise<any> {
    return kubectl("get pods").then((podsjson) => {
            return podsjson["items"];
    });
}

function findcontainer(imageid, podname): Promise<string> {
    return kubectl("get pods").then((podsjson) => {

        for (let pod of podsjson["items"]) {
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

function requestAttachment(imgid, pod, container): Promise<string> {
    console.log(`requestAttachment ${imgid}, ${pod}, ${container}`);
    
    return dbgclient(`app attach ${imgid} ${pod} ${container}`).then((res) => {
        return res["DebugSessionId"];
    });
}
function waitForAttachment(imgid, token): Promise<[string, number]> {
    return pdeadline.deadline(_waitForAttachmentDeadline(imgid, token), 60 * 1000)
}

function _waitForAttachmentDeadline(imgid, token): Promise<[string, number]> {
    return dbgclient(`session  wait ${imgid} ${token}`).then((res) => {
        return res["DebugSessionId"];
    }).catch((err) => {
        let [code, errinfo] = err[0];
        let errinfojson = JSON.parse(errinfo);
        if (errinfojson["Type"] == "Timeout") {
            return _waitForAttachmentDeadline(imgid, token)
        }
    });
}

function portforward(port, remote): Promise<void> {
    let remoteparts = remote["DebugUrl"].split(":");
    if (remoteparts.length != 2) {
        throw new Error('Invalid remote');
    }
    let pod = remoteparts[0];
    let podport = remoteparts[1];

    // exec async..
    kubectl(`port-forward  ${pod} ${port}:${podport}`);

    return Promise.resolve()
}

function kubectl(cmd): Promise<any> {
    return execjson(get_conf_or("kubectl-path","kubectl")  + " -o json " + cmd);
}

function get_conf_or(k,d) {
    let config = vscode.workspace.getConfiguration('vs-squash');
    let v = config[k];
    if (!v) {
        return d;
    }
    return v;
}


function dbgclient(cmd): Promise<any> {
    return execjson(get_conf_or("dbgclient-path","dbgclient")  + " --json=true " + cmd);
}

function execjson(cmd): Promise<any> {
    return exec(cmd).then((output) => {
        return JSON.parse(output);
    });
}

function exec(cmd): Promise<any> {

    return new Promise((resolve, reject) => {

        let handler = function (code, stdout, stderr) {
            if (code !== 0) {
                reject(new ExecError(code, stderr))
            }
            resolve(stdout)
        };
        shelljs.exec(cmd, handler)

    });

}

// https://github.com/Microsoft/TypeScript/wiki/Breaking-Changes#extending-built-ins-like-error-array-and-map-may-no-longer-work
class ExecError extends Error {
    code : number;
    stderr : string;

    constructor(code : number, stderr : string) {
        super(stderr.trim());

        // Set the prototype explicitly.
        Object.setPrototypeOf(this, ExecError.prototype);
    }
}

