let devHidVS;

function buf2hex(buf, del) {
    return Array.from(new Uint8Array(buf))
    .map (b => b.toString (16).padStart (2, "0"))
    .join (del);
}

async function bread(offset) {
    off = new DataView(new ArrayBuffer(2));
    off.setUint16(0, offset, false);
    
    let hidPpShort = new ArrayBuffer(6);
    let data = new DataView(hidPpShort)
    data.setUint8(0, 0xff) // device ID
    data.setUint8(1, 0x81) // MsgSubID / type (GET register request)
    data.setUint8(2, 0xd4) // p1 (reg 0xd4)
    data.setUint8(4, off.getUint8(0)); // p2 (readAddr LSB)
    data.setUint8(3, off.getUint8(1)); // p3 (readAddr MSB)
    data.setUint8(5, 0x00) // p4
  
    res = new Promise( function(resolve, reject) {
        
        let wrongRsp = 0;
        let waitRsp = (inp) => {
            u8rsp = new Uint8Array(inp.data.buffer);
            u8req = new Uint8Array(data.buffer);

            //console.log("Rsp " + wrongRsp.toString() + ": " + buf2hex(inp.data.buffer, ":"));

            let match = true;
            for (let i=0; i<5;i++) {
                if (u8req[i] !== u8rsp[i]) match = false;
            }
            if (match) {
                devHidVS.removeEventListener('inputreport', waitRsp);
                resolve(u8rsp[5]);
                return;
            } 

            wrongRsp++;

            if (u8rsp[0] === 0xff && u8rsp[1] === 0x8f && u8rsp[2] === 0x81 && u8rsp[3] === 0xd4) {
                devHidVS.removeEventListener('inputreport', waitRsp);
                reject("too many wronge responses for read offset 0x" + offset.toString(16).padStart (4, "0"));
                return
            }
        
            if (wrongRsp > 10) {
                devHidVS.removeEventListener('inputreport', waitRsp);
                reject("read error for offset 0x" + offset.toString(16).padStart (4, "0"));
                return;
            }
        };

        devHidVS.addEventListener('inputreport', waitRsp);
    
    });
    devHidVS.sendReport(0x10, data.buffer);
    return res;
}

function dumpDevData() {
    let pages = flashPagesToConsider = [0xe400, 0xe800, 0xec00, 0xf000];
    return new Promise(async function(resolve, reject) {
        try {

            let activePage = 0;
            for (let i=0; i<pages.length; i++) {
                val = await bread(pages[i]);
                console.log(val.toString(16))
                if (val === 0x3f) activePage = pages[i];
            }
    
            if (activePage === 0) reject("no valid flash page found");
    
            let res = {dongle:{}, devices: []}
            for (let curEntryID = activePage + 4; curEntryID < activePage+0x400; curEntryID += 0x14) {
                eID = await bread(curEntryID);
    
                if (eID == 0xff) break;
    
                if (eID === 0x02) {
                    fw_maj = await bread(curEntryID + 4);
                    fw_min = await bread(curEntryID + 5);
                    fw_b = await bread(curEntryID + 6);
                    fw_b = fw_b << 8;
                    fw_b += await bread(curEntryID + 7);
                    wpid = await bread(curEntryID + 8);
                    wpid = wpid << 8;
                    wpid += await bread(curEntryID + 9);
                    
                    res.dongle.fw = "RQR" + fw_maj.toString(16).padStart (2, "0");
                    res.dongle.fw += "." + fw_min.toString(16).padStart (2, "0");
                    res.dongle.fw += ".B" + fw_b.toString(16).padStart (4, "0");
                    res.dongle.WPID = "" + wpid.toString(16).padStart (4, "0");
                    continue;
                }
    
                if (eID === 0x03 && res.dongle.serial === undefined) {
                    res.dongle.serial = (await bread(curEntryID + 4)).toString(16).padStart (2, "0") + ":";
                    res.dongle.serial += (await bread(curEntryID + 5)).toString(16).padStart (2, "0") + ":";
                    res.dongle.serial += (await bread(curEntryID + 6)).toString(16).padStart (2, "0") + ":";
                    res.dongle.serial += (await bread(curEntryID + 7)).toString(16).padStart (2, "0");
                    continue;
                }
    
                if (eID === 0x7c) continue;
    
                devID = eID & 0x0f;
                eID = eID & 0xf0;
    
                if (eID != 0 && devID >= res.devices.length) {
                    res.devices.push({}); // add new dev obj to array
                }
                
                switch (eID) {
                    case 0x20:
                        res.devices[devID].addr = res.dongle.serial + ":";
                        let prefix = await bread(curEntryID + 4);
                        res.devices[devID].addr += prefix.toString(16).padStart (2, "0");
                        break;
                    case 0x40:
                        devName = new Uint8Array(new ArrayBuffer(await bread(curEntryID + 4)));
                        for (let pos=0; pos < devName.length; pos++) {
                            devName[pos] = await bread(curEntryID + 5 + pos);
                        }
                        res.devices[devID].devName = new TextDecoder().decode(devName);
                        break;
                    case 0x60:
                        let key = new Uint8Array(new ArrayBuffer(16));
                        key[0] = await bread(curEntryID + 4 + 7);
                        key[1] = await bread(curEntryID + 4 + 1);
                        key[1] ^= 0x00ff;
                        key[2] = await bread(curEntryID + 4);
                        key[3] = await bread(curEntryID + 4 + 3);
                        key[4] = await bread(curEntryID + 4 + 10);
                        key[5] = await bread(curEntryID + 4 + 2);
                        key[5] ^= 0xff;
                        key[6] = await bread(curEntryID + 4 + 9);
                        key[6] ^= 0x55;
                        key[7] = await bread(curEntryID + 4 + 14);
                        key[8] = await bread(curEntryID + 4 + 8);
                        key[9] = await bread(curEntryID + 4 + 6);
                        key[10] = await bread(curEntryID + 4 + 12);
                        key[10] ^= 0xff;
                        key[11] = await bread(curEntryID + 4 + 5);
                        key[12] = await bread(curEntryID + 4 + 13);
                        key[13] = await bread(curEntryID + 4 + 15);
                        key[13] ^= 0x55;
                        key[14] = await bread(curEntryID + 4 + 4);
                        key[15] = await bread(curEntryID + 4 + 11);
    
                        //res.devices[devID].key = key;
                        res.devices[devID].devAESKey = buf2hex(key,"");
                        break;
                }        
            }
            resolve(res);
        } catch(e) {
            reject(e);
        }
    });    
}

window.onload = () => {
    const bt1 = document.getElementById('bt1');

    if (navigator.hid === undefined) {
        document.getElementById("result").value += "WebHID not available. For Chrome 78 WebHID could be enabled with the flag 'Experimental Web Platform features' \n";
    }

    bt1.onclick = async () => {
        devs = await navigator.hid.getDevices();
        if (devs.length == 0) {
            devHidVS = await navigator.hid.requestDevice({filters:[{vendorId: 0x046d, usagePage: 0xff00}]});  
        } else {
            devHidVS = devs[0];
        }
        
        try {
            if (!devHidVS.opened) await devHidVS.open();

            devData = await dumpDevData();
            
            document.getElementById("result").value += JSON.stringify(devData, null, 1) + "\n";
            devData.devices.forEach(dev => {
                document.getElementById("commands").value += "devices add " + dev.addr.toUpperCase() + " " + dev.devAESKey.toUpperCase() + "\n";
                document.getElementById("commands").value += "devices storage save " + dev.addr.toUpperCase() + "\n";
            });    
        } catch (e) {
            document.getElementById("result").value += "Can't dump keys from selected device (no TI chip or patched against key extraction)\n";
        }
    }    
}