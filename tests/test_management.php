<?php
declare(strict_types=1);
// Unit harness: no Docker, real server mutation, database or external requests.
class Reply extends Exception {public function __construct(public array $data, public int $status) {parent::__construct();}}
function json_response(array $data, int $status=200): void {throw new Reply($data,$status);}
function central_gateway_user(): ?array {return $GLOBALS['user'];}
function local_host_record(): array {return ['id'=>1,'is_enabled'=>1,'shared_game_path'=>'/game','shared_dlc_path'=>'/dlc','shared_installer_path'=>'/installer'];}
function find_instance_with_host(string $id): ?array {return $id==='existing'?['instance_id'=>$id,'host_id'=>1]:($id==='other'?['instance_id'=>$id,'host_id'=>2]:null);}
function server_command_actions(): array {return ['start','stop','restart','backend_reboot','logs'];}
function file_context_for_request($host,$server,$target): ?array {return in_array($target,['game','mods'])?['path'=>'/test']:null;}
function normalize_relative_subpath(string $path): ?string {return str_contains($path,'..')?null:$path;}
function directory_listing_for_context($context,$subpath): array {return ['ok'=>true,'files'=>[]];}
function canonical_fs25_image_name(string $name): string {return $name;}
function is_safe_sftp_credential(string $value): bool {return (bool) preg_match('/^[a-zA-Z0-9._-]+$/D',$value);}
function instance_secrets_for_server(array $server): array {return ['ok'=>true,'secrets'=>['vnc_password'=>'vnc']];}
function resolved_access_endpoint(array $server): ?array {return ['scheme'=>'http','host'=>'node.example.test'];}
function instance_access_url(array $server, string $kind): ?string {return $kind==='sftp'?'sftp://node.example.test:2222':null;}
require __DIR__.'/../app/web/src/management.php';
function check(string $operation,string $method,string $role,array $query=[],array $post=[],int $status=200,?string $route=null): void {
    $GLOBALS['user']=$role==='none'?null:['role'=>$role];$_GET=array_merge(['operation'=>$operation],$query);$_POST=$post;$_SERVER=['REQUEST_METHOD'=>$method,'CONTENT_LENGTH'=>'0'];
    try {$actual=central_management();if($status!==200||$actual!==$route)throw new Exception('Unexpected route for '.$operation);}
    catch(Reply $r){if($r->status!==$status)throw new Exception($operation.': expected '.$status.', got '.$r->status.' '.json_encode($r->data));}
}
check('inventory','GET','none',[],[],401);
check('delete','GET','admin',[],[],405);
check('save','POST','operator',[],[],403);
check('server','GET','operator',[],[],403);
check('live','GET','operator',['instance_id'=>'other'],[],404);
check('command','POST','operator',['instance_id'=>'existing'],['action'=>'arbitrary'],422);
check('command','POST','operator',['instance_id'=>'existing'],['action'=>'start'],200,'server_command');
check('files','GET','admin',['target'=>'bad'],[],422);
check('files','GET','admin',['target'=>'game','subpath'=>'../secret'],[],422);
check('files','GET','admin',['target'=>'game'],[],200);
check('delete','POST','admin',['instance_id'=>'existing'],['delete_code'=>'existing'],200,'server_delete');
check('upload','POST','operator',[],[],403);
$GLOBALS['user']=['role'=>'admin'];$_GET=['operation'=>'server','instance_id'=>'existing'];$_POST=[];$_SERVER=['REQUEST_METHOD'=>'GET','CONTENT_LENGTH'=>'0'];
try{central_management();throw new Exception('Server operation did not respond');}
catch(Reply $r){if($r->status!==200||($r->data['access']['host']??null)!=='node.example.test'||($r->data['access']['sftp_url']??null)!=='sftp://node.example.test:2222'||($r->data['secrets']['secrets']['vnc_password']??null)!=='vnc')throw new Exception('Server operation is missing SFTP access details: '.json_encode($r->data));}
echo "Server operation SFTP access details test passed.\n";
echo "Management permissions, scope and dispatch tests passed.\n";

class FakeStatement {
    public function fetchColumn(): int {return 1;}
    public function execute(array $values): void {$GLOBALS['writes'][]=$values;}
}
class FakeDatabase {
    public function query(string $sql): FakeStatement {return new FakeStatement();}
    public function prepare(string $sql): FakeStatement {return new FakeStatement();}
}
function db(): FakeDatabase {return new FakeDatabase();}
function find_port_conflicts($payload,$exclude,$host): array {return $GLOBALS['conflicts']??[];}
function suggested_create_defaults(): array {return $GLOBALS['defaults'];}
function agent_post_for_host($host,$path,$payload,$timeout=20): array {$GLOBALS['sent']=$payload;return ['ok'=>true];}
function sync_instance_config_for_server($server): array {$GLOBALS['sent']=$server;return ['ok'=>$GLOBALS['sync_ok']??true];}
$defaults=['instance_id'=>'new-server','server_name'=>'Farm','image_name'=>'fsg/fs25-runtime:local','server_port'=>10823,'web_port'=>18000,'tls_port'=>28000,'vnc_port'=>5900,'novnc_port'=>6080,'sftp_port'=>2222,'sftp_username'=>'farm','sftp_password'=>'safe-secret','web_username'=>'admin','web_password'=>'password','server_players'=>16,'server_region'=>'en','server_map'=>'MapUS','server_password'=>'join','server_admin'=>'admin','server_difficulty'=>3,'server_pause'=>2,'server_save_interval'=>180,'server_stats_interval'=>360,'puid'=>1000,'pgid'=>1000,'vnc_password'=>'vnc','autostart_server'=>'true'];
$GLOBALS['defaults']=$defaults;$GLOBALS['writes']=[];
check('create','POST','admin',[],['server_port'=>70000],422);
check('create','POST','admin',[],['instance_id'=>'bad/id'],422);
check('create','POST','admin',[],['sftp_password'=>'bad:password'],422);
$GLOBALS['conflicts']=['Port already used'];check('create','POST','admin',[],[],409);$GLOBALS['conflicts']=[];
check('create','POST','admin',[],['server_crossplay'=>'true'],200);
if(count($GLOBALS['writes'])!==1||$GLOBALS['sent']['server_crossplay']!==true||$GLOBALS['sent']['shared_game_path']!=='/game')throw new Exception('Create payload or persistence failed');
$GLOBALS['writes']=[];$GLOBALS['sync_ok']=false;$_POST=['server_name'=>'Updated','web_password'=>''];
try{management_save(local_host_record(),array_merge($defaults,['host_id'=>1]));}catch(Reply $reply){if($reply->status!==502)throw new Exception('Sync failure not returned');}
if($GLOBALS['writes']!==[]||$GLOBALS['sent']['web_password']!=='password')throw new Exception('Failed sync changed saved settings or erased password');
$GLOBALS['sync_ok']=true;$_POST=['server_name'=>'Updated','web_password'=>'','server_players'=>'4','server_map'=>'Changed','server_region'=>'de'];
try{management_save(local_host_record(),array_merge($defaults,['host_id'=>1]));}catch(Reply $reply){if($reply->status!==200)throw new Exception('Update failed');}
if(count($GLOBALS['writes'])!==1)throw new Exception('Successful update did not persist');
// Player limit, region and map belong to the game admin panel after creation: never stored or synced for an existing server.
foreach(['Changed','de',4] as $value)if(in_array($value,$GLOBALS['writes'][0],true))throw new Exception('Game-owned setting was stored');
if(!in_array('Updated',$GLOBALS['writes'][0],true)||$GLOBALS['sent']['server_map']!=='MapUS'||$GLOBALS['sent']['server_players']!==16)throw new Exception('Site label not saved or game-owned setting synced');
echo "Management create/update validation, credential preservation, game-owned setting protection and sync failure tests passed.\n";
